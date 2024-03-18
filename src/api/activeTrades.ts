import { MongoClient } from 'mongodb';
import chalk from 'chalk';

import { type BuyTxResult, type Bid, type BuyTxInfo, type CardToBuy, type GlobalParams } from '../types/trade';
import * as tradesRepo from '../dal/tradesRepo';
import { add_CARDS, calculate_profit, calculate_sellPrice, calculate_break_even } from './sell';
import * as cardsApi from './cards';
import * as hive from './hive';
import * as user from './user';
import './../utility/number';
import { MarketData, getCardPrices } from './market';

type TradeLog = {
	account: string;
	uid: string;
	name: string;
	buy: number;
	sell: number;
	profit: number;
};

export default class ActiveTrades {
	private lastChecked = 0;
	private tableLogs: TradeLog[] = [];
	private removedTradeCount = 0;

	constructor(private mongoClient: MongoClient, private params: GlobalParams) {}

	async Check(marketData: MarketData[] | null, page: number = 0) {
		if (!marketData) return;

		if (page === 0 && Date.now() - this.lastChecked < 60 * 60 * 1000) return;
		this.lastChecked = Date.now();

		let activeTrades = await tradesRepo.findActiveTrades(this.mongoClient, 10 * page - this.removedTradeCount, 10);
		if (!activeTrades || activeTrades.length === 0) return;

		const cardsInfo = await cardsApi.findCardInfo(activeTrades.map((t) => t.uid));
		for (const trade of activeTrades) {
			const cardInfo = cardsInfo.find((c: { uid: string }) => c.uid === trade.uid);
			if (!cardInfo) continue;

			await this.checkTrade(trade, cardInfo, marketData);
			if (trade.status_id != 0) continue;
			this.pushLogToTable(trade, cardInfo);
		}

		const transformed = this.tableLogs.reduce((log, { uid, ...x }) => {
			log[uid] = x;
			return log;
		}, {} as { [uid: string]: Omit<TradeLog, 'uid'> });
		console.table(transformed);
		this.tableLogs = [];
		await this.Check(marketData, ++page);
	}

	public CreateTrade(acc: string, buying_data: CardToBuy, tx: BuyTxInfo, bid: Bid, tx_result: BuyTxResult) {
		let marketPrice = buying_data.bcx > 1 ? buying_data.buy_price.low_price_bcx : buying_data.buy_price.low_price;
		const sellPrice = calculate_sellPrice(marketPrice as number, buying_data.price, bid.sell_for_pct_more);

		const trade = {
			account: acc,
			uid: buying_data.card_id,
			card_id: buying_data.card_detail_id,
			card_name: buying_data.card_name,
			create_date: tx.created_date,
			bcx: buying_data.bcx,
			status_id: 0,
			status: 'Active',
			profit_usd: 0,
			profit_margin: 0,
			bid_idx: buying_data.bid_idx,
			bid_desc: bid.comment,
			buy: {
				tx_id: tx.id,
				dec: tx_result.total_dec / tx_result.by_seller[0].items.length,
				usd: buying_data.price,
				market_price: buying_data.buy_price,
			},
			sell: {
				usd: sellPrice,
				tx_count: 0,
				break_even: 0,
			},
		} as tradesRepo.Trade;

		calculate_profit(trade, sellPrice);

		tradesRepo.insertTrade(this.mongoClient, trade).catch((e) => console.log('Trade insert failed:', e));

		return trade;
	}

	private pushLogToTable(trade: tradesRepo.Trade, cardInfo: cardsApi.CardInfo) {
		const onMarket = !!(cardInfo.market_id && cardInfo.market_listing_type === 'SELL');
		if (onMarket) calculate_profit(trade, Number(cardInfo.buy_price));
		this.tableLogs.push({
			account: trade.account,
			uid: trade.uid,
			name: cardInfo.details.name,
			buy: trade.buy.usd,
			sell: onMarket ? trade.sell!.usd || 0 : 0,
			profit: onMarket ? trade.profit_usd : 0,
		});
	}

	private async checkTrade(trade: tradesRepo.Trade, cardInfo: cardsApi.CardInfo, marketData: MarketData[]) {
		await this.checkXp(trade, cardInfo);

		if (cardInfo.player !== trade.account) {
			//card was sold
			await this.finish(trade, this.params);
			this.removedTradeCount--;
			return;
		}

		if (cardInfo.combined_card_id || cardInfo.xp !== trade.xp) {
			// card was combined or burned
			await tradesRepo.closeTrade(this.mongoClient, trade);
			this.removedTradeCount--;
			return;
		}

		if (trade.is_manual === true) return;

		if (cardInfo.xp === 1 && cardInfo.market_id && cardInfo.market_listing_type === 'SELL') {
			const updated = await this.updateCardPrice(cardInfo, trade, Object.keys(this.params.accounts));
			if (!updated) return;

			calculate_profit(trade, updated.newPrice);
			console.log(
				chalk.bold.cyan([
					`[${trade.uid}] ${trade.card_name || ''}'s price changed`,
					` from ${updated.oldPrice} to ${updated.newPrice}`,
					` profit: $${trade.profit_usd} ${trade.profit_margin}%`,
				])
			);
			trade.sell = {
				...trade.sell,
				usd: updated.newPrice,
				tx_id: updated.id,
				break_even: trade.sell?.break_even || calculate_break_even(trade.buy.usd),
				tx_count: (trade.sell?.tx_count || 0) + 1,
			};

			tradesRepo.updateTrade(this.mongoClient, trade);
			return;
		}

		if (
			!cardInfo.market_listing_type && //not rented or sold
			!cardInfo.delegated_to && // not delegated
			!cardInfo.lock_days && // not locked
			(!cardInfo.stake_plot ||
				(cardInfo.stake_end_date && Date.now() > new Date(cardInfo.stake_end_date).getTime())) // not staked to land and not in unstaking period
		) {
			await this.sellOldTrade(marketData, trade, cardInfo.gold);
		}
	}

	private async checkXp(trade: tradesRepo.Trade, cardInfo: cardsApi.CardInfo): Promise<void> {
		if (trade.xp) return;

		trade.xp = cardInfo.xp;
		trade.card_id = cardInfo.card_detail_id;
		trade.card_name = cardInfo.details.name;
		trade.create_date = trade.create_date || new Date().toISOString();
		trade.bcx = trade.bcx || cardInfo.bcx;
		trade.profit_usd = trade.profit_usd || 0;
		trade.profit_margin = trade.profit_margin || 0;
		trade.status_id = 0;
		trade.status = 'Active';
		trade.buy = trade.buy || { usd: Number(cardInfo.last_buy_price) || 0 };
		trade.sell = trade.sell || {
			usd: Number(cardInfo.buy_price) || 0,
			tx_id: cardInfo.market_id || '',
			tx_count: cardInfo.market_listing_type === 'SELL' ? 1 : 0,
			break_even: calculate_break_even(trade.buy.usd),
		};
		if (cardInfo.buy_price) calculate_profit(trade, Number(cardInfo.buy_price));

		await tradesRepo.updateTrade(this.mongoClient, trade);
	}

	private async finish(trade: tradesRepo.Trade, params: GlobalParams) {
		calculate_profit(trade, await cardsApi.findCardSellPrice(trade.uid, trade.account));

		const fee = trade.profit_usd * ((params.profit_fee_pct || 5) / 100);
		const signedTx = await hive.transfer_fee(trade.account, fee);
		user.transferFee(signedTx);

		await tradesRepo.finishTrade(this.mongoClient, trade);

		console.log(
			chalk.bold.green([
				`${trade.account} sold [${trade.uid}] ${trade.card_name || ''}`,
				` profit: $${trade.profit_usd} ${trade.profit_margin}%`,
			])
		);
	}

	private async updateCardPrice(card_info: cardsApi.CardInfo, trade: tradesRepo.Trade, accounts: string[]) {
		const cardPrices = await getCardPrices(card_info.card_detail_id, card_info.gold);
		if (!cardPrices) return null;

		let posIndex = cardPrices.findIndex((x) => x.uid === card_info.uid);
		const filteredPrices = cardPrices.slice(0, posIndex).filter((c) => !accounts.includes(c.seller));
		filteredPrices.push(cardPrices[posIndex]);
		posIndex = filteredPrices.length - 1;
		const rarity: number = card_info.details.rarity;
		let maxPosForRarity = -3 * rarity + 16; // 13 | 10 | 7 | 4
		if (card_info.gold) maxPosForRarity = maxPosForRarity / 2.5; // 5.2 | 4 | 2.8 | 1.6

		if (posIndex == 0 || posIndex + 1 < maxPosForRarity) return null;

		const be = trade.sell?.break_even || calculate_break_even(trade.buy.usd);
		let newPrice = Math.max(filteredPrices[0].buy_price - 0.001, be);

		for (let i = 1; i < Math.min(posIndex, maxPosForRarity); i++) {
			const prev = filteredPrices[i - 1];
			const curr = filteredPrices[i];
			if (curr.buy_price <= newPrice) {
				maxPosForRarity++;
				continue;
			}
			if (newPrice === be) newPrice = curr.buy_price - 0.001;
			if ((curr.buy_price - prev.buy_price) / curr.buy_price < 0.08) continue;
			newPrice = curr.buy_price - 0.001;
			break;
		}

		newPrice = newPrice.toFixed3();

		if (newPrice >= filteredPrices[posIndex].buy_price || newPrice <= be) return null;

		const jsondata = {
			ids: [filteredPrices[posIndex].market_id],
			new_price: newPrice,
			list_fee: 1,
			list_fee_token: 'DEC',
		};
		const tx = await hive.update_card_price(trade.account, jsondata).catch((e) => {
			console.log('ERROR in hive.update_card_price:', e);
			return null;
		});
		return tx ? { id: tx.id, oldPrice: filteredPrices[posIndex].buy_price, newPrice } : null;
	}

	private async sellOldTrade(marketData: MarketData[], trade: tradesRepo.Trade, gold: boolean) {
		const cardPrices = marketData.find((c) => c.card_detail_id === trade.card_id && c.gold === gold);
		if (!cardPrices) return;

		const marketPrice = trade.bcx > 1 ? cardPrices.low_price_bcx : cardPrices.low_price;
		trade.sell = trade.sell || { usd: 0, break_even: 0, tx_count: 0 };
		trade.sell.break_even = trade.sell.break_even || calculate_break_even(trade.buy.usd);
		if (marketPrice > trade.sell.break_even) {
			let breakEvenPct = 100 - Math.trunc((trade.buy.usd / trade.sell.break_even) * 100);
			const sellPrice = calculate_sellPrice(marketPrice, trade.buy.usd, breakEvenPct || undefined);
			calculate_profit(trade, sellPrice);

			await tradesRepo.updateTrade(this.mongoClient, trade);

			add_CARDS(trade.account, [
				{
					cards: [trade.uid],
					currency: 'USD',
					price: sellPrice.toFixed3(),
					fee_pct: 600,
					list_fee: 1,
					list_fee_token: 'DEC',
				},
			]);

			console.log(
				chalk.bold.cyan([
					`[${trade.uid}] ${trade.card_name || ''} will be put to market for ${sellPrice.toFixed3()}`,
					` profit: $${trade.profit_usd} ${trade.profit_margin}%`,
				])
			);
		}
	}
}
