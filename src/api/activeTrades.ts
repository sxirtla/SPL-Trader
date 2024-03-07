import { MongoClient } from 'mongodb';
import chalk from 'chalk';

import { GlobalParams } from '../types/trade';
import * as tradesRepo from '../dal/tradesRepo';
import { add_CARDS, calculate_profit, calculate_sellPrice, calculate_break_even } from './sell';
import * as cardsApi from './cards';
import * as hive from './hive';
import * as user from './user';
import { MarketData, getCardPrices } from './market';

type TradeLog = {
	account: string;
	uid: string;
	name: string;
	buy_price: number;
	sell_price: number;
	profit_usd: number;
	on_market: boolean;
};

export default class ActiveTrades {
	private lastChecked = 0;
	private tableLogs: TradeLog[] = [];

	constructor(private mongoClient: MongoClient, private params: GlobalParams) {}

	async Check(marketData: MarketData[] | null, page: number = 0) {
		if (!marketData) return;

		if (page === 0 && Date.now() - this.lastChecked < 60 * 60 * 1000) return;
		this.lastChecked = Date.now();

		let activeTrades = await tradesRepo.findActiveTrades(this.mongoClient);
		activeTrades = activeTrades.slice(10 * page, 10 * (page + 1));
		if (!activeTrades || activeTrades.length === 0) return;

		let cards_info = await cardsApi.findCardInfo(activeTrades.map((t) => t.uid));
		for (const trade of activeTrades) {
			let card_info = cards_info.find((c: { uid: string }) => c.uid === trade.uid);
			if (!card_info) continue;

			await this.checkTrade(trade, card_info, marketData);
			if (trade.status_id != 0) continue;
			this.tableLogs.push({
				account: trade.account,
				uid: trade.uid.substring(0, 10),
				name: card_info.details.name,
				buy_price: trade.buy.usd,
				sell_price: Number(trade.sell?.usd.toFixed(3)) || 0,
				profit_usd: Number(trade.profit_usd.toFixed(3)),
				on_market: !!(card_info.market_id && card_info.market_listing_type === 'SELL'),
			});
		}

		console.table(this.tableLogs);
		this.tableLogs = [];
		await this.Check(marketData, ++page);
	}

	private async checkTrade(trade: tradesRepo.Trade, card_info: any, marketData: MarketData[]) {
		await this.checkXp(trade, card_info);

		if (card_info.player !== trade.account) {
			//card was sold
			await this.finish(trade, this.params);
			return;
		}

		if (card_info.combined_card_id || card_info.xp !== trade.xp) {
			// card was combined or burned
			await tradesRepo.closeTrade(this.mongoClient, trade);
			return;
		}

		if (trade.is_manual === true) return;

		if (card_info.xp === 1 && card_info.market_id && card_info.market_listing_type === 'SELL') {
			let updated = await this.updateCardPrice(card_info, trade, Object.keys(this.params.accounts));
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
			!card_info.market_listing_type && //not rented or sold
			!card_info.delegated_to && // not delegated
			!card_info.lock_days && // not locked
			(!card_info.stake_plot ||
				(card_info.stake_end_date && Date.now() > new Date(card_info.stake_end_date).getTime())) // not staked to land and not in unstaking period
		) {
			await this.sellOldTrade(marketData, trade, card_info.gold);
		}
	}

	private async checkXp(trade: tradesRepo.Trade, card_info: any) {
		if (!trade.xp) {
			trade.xp = card_info.xp;
			trade.card_id = card_info.card_detail_id;
			trade.card_name = card_info.details.name;
			trade.create_date = trade.create_date || new Date().toISOString();
			trade.bcx = trade.bcx || card_info.bcx;
			trade.profit_usd = trade.profit_usd || 0;
			trade.profit_margin = trade.profit_margin || 0;
			trade.status_id = 0;
			trade.status = 'Active';
			trade.buy = trade.buy || { usd: Number(card_info.last_buy_price) || 0 };
			trade.sell = trade.sell || {
				usd: Number(card_info.buy_price) || 0,
				tx_id: card_info.market_id || '',
				tx_count: card_info.market_listing_type === 'SELL' ? 1 : 0,
				break_even: calculate_break_even(trade.buy.usd),
			};
			if (card_info.buy_price) calculate_profit(trade, Number(card_info.buy_price));

			await tradesRepo.updateTrade(this.mongoClient, trade);
		}
	}

	private async finish(trade: tradesRepo.Trade, params: GlobalParams) {
		calculate_profit(trade, await cardsApi.findCardSellPrice(trade.uid, trade.account));

		let fee = trade.profit_usd * ((params.profit_fee_pct || 5) / 100);
		let signedTx = await hive.transfer_fee(trade.account, fee);
		user.transferFee(signedTx);

		await tradesRepo.finishTrade(this.mongoClient, trade);

		console.log(
			chalk.bold.green([
				`${trade.account} sold [${trade.uid}] ${trade.card_name || ''}`,
				` profit: $${trade.profit_usd} ${trade.profit_margin}%`,
			])
		);
	}

	private async updateCardPrice(card_info: any, trade: tradesRepo.Trade, accounts: string[]) {
		let cardPrices = await getCardPrices(card_info.card_detail_id, card_info.gold);
		if (!cardPrices) return null;

		let posIndex = cardPrices.findIndex((x: any) => x.uid === card_info.uid);
		let filteredPrices = cardPrices.slice(0, posIndex).filter((c: any) => !accounts.includes(c.seller));
		filteredPrices.push(cardPrices[posIndex]);
		posIndex = filteredPrices.length - 1;
		let rarity: number = card_info.details.rarity;
		let maxPosForRarity = -3 * rarity + 16; // 13 | 10 | 7 | 4
		if (card_info.gold) maxPosForRarity = maxPosForRarity / 2.5; // 5.2 | 4 | 2.8 | 1.6

		if (posIndex == 0 || posIndex + 1 < maxPosForRarity) return null;

		const be = (trade.sell?.break_even || calculate_break_even(trade.buy.usd));
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

		newPrice = Number(newPrice.toFixed(3));

		if (newPrice >= filteredPrices[posIndex].buy_price || newPrice <= be) return null;

		let jsondata = {
			ids: [filteredPrices[posIndex].market_id],
			new_price: newPrice,
			list_fee: 1,
			list_fee_token: 'DEC',
		};
		let tx = await hive.update_card_price(trade.account, jsondata).catch((e) => {
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
					price: Number(sellPrice.toFixed(3)),
					fee_pct: 600,
					list_fee: 1,
					list_fee_token: 'DEC',
				},
			]);

			console.log(
				chalk.bold.cyan([
					`[${trade.uid}] ${trade.card_name || ''} will be put to market for ${Number(sellPrice.toFixed(3))}`,
					` profit: $${trade.profit_usd} ${trade.profit_margin}%`,
				])
			);
		}
	}
}
