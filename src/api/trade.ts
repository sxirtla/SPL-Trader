import chalk from 'chalk';
import * as hive from './hive';
import { GameSettings, LocalSettings, SellCards, CardToBuy, BuyTxInfo, BuyTxResult, Bid } from '../types/trade';
import { MongoClient } from 'mongodb';

import { sleep } from '../utility/helper';
import * as market from './market';
import * as cardsApi from './cards';
import { readSettings } from './settings';
import { getUsableBalance } from './user';
import { generateBidPrices, setupBids } from './bids';
import { manage_rc } from './rc';
import * as sell from './sell';
import ActiveTrades from './activeTrades';
import './../utility/number';

export default class Trade {
	private _gameSettings: GameSettings;
	private readonly _lookingForCards: string[] = [];
	private readonly _accounts: string[] = [];
	private readonly _bids: Bid[] = [];
	private readonly _activeTrades: ActiveTrades;
	private _usdBalances: { [x: string]: number } = {};
	private _lastChecked = 0;
	private _minuteTimer = 0;
	private _slApiCallsPerMinute = 0;
	private _buyingAccountNumber: { [x: string]: number } = {};
	private readonly CONSTS: { MIN_DEC_PRICE: number } = { MIN_DEC_PRICE: 0.0009 };

	constructor(private settings: LocalSettings, private readonly _cardDetails: any, private mongoClient: MongoClient) {
		this._gameSettings = readSettings();
		this._accounts = Object.keys(settings.global_params.accounts);
		hive.init(settings.global_params.preferred_hive_node);
		hive.generateKey(settings.global_params);
		this._bids = this.settings.bids;
		this._lookingForCards = [...new Set(setupBids(this._bids, this._cardDetails))];
		this._activeTrades = new ActiveTrades(mongoClient, settings.global_params);
	}

	async getCurrentBalance(acc: string) {
		this._gameSettings = readSettings();

		let balance = await getUsableBalance(acc, this.settings.global_params.accounts[acc]);

		this._usdBalances[acc] =
			this.settings.global_params.accounts[acc].currency == 'DEC'
				? (balance * this._gameSettings.dec_price).toFixed3()
				: (balance / 1000).toFixed3();

		return;
	}

	async get_marketData_and_update_bid_prices() {
		console.log(new Date().toLocaleTimeString('en-US', { hour12: false }), '- fetching market prices...');
		let prices = await market.getPrices();
		const pm_bids = await market.getBids();
		if (prices.length === 0 || !pm_bids) {
			return null;
		}
		for (const bid of this._bids) {
			if (!bid.prices) bid.prices = {};

			generateBidPrices(bid, pm_bids, prices, this.settings.global_params);
		}

		console.log(new Date().toLocaleTimeString('en-US', { hour12: false }), '- done');
		return prices;
	}

	async run_job(delay: number = 5) {
		if (Date.now() - this._lastChecked < delay * 60 * 1000) return;

		this._lastChecked = Date.now();

		//await tradesRepo.reCalculateTotals(this.mongoClient);

		for (let i = 0; i < this._accounts.length; i++) {
			const acc = this._accounts[i];
			await this.getCurrentBalance(acc);
			await manage_rc(acc, this.settings.global_params);
		}

		console.log('');
		console.log('DEC price: ', this._gameSettings.dec_price * 1000);
		console.log(this._usdBalances);

		let marketData = await this.get_marketData_and_update_bid_prices();

		await sell.sell_cards(this.mongoClient).catch((e) => console.log('error in sell_cards:', e));

		await this._activeTrades.Check(marketData);
	}

	revert_balance_and_quantities(acc: string, buy: CardToBuy) {
		this._usdBalances[acc] += buy.price;

		this._buyingAccountNumber[buy.card_id] -= 1;
		if (this._buyingAccountNumber[buy.card_id] === 0) {
			let bid = this._bids[buy.bid_idx];
			if (!bid || !bid.cards) return;
			bid.cards[buy.card_detail_id].quantity = (bid.cards[buy.card_detail_id].quantity || 0) + (buy.bcx || 1);
			delete this._buyingAccountNumber[buy.card_id];
			console.log('quantity restored to:', bid.cards[buy.card_detail_id].quantity?.toString());
		}
	}

	handle_success(acc: string, buying_data: CardToBuy, tx_result: BuyTxResult, tx: BuyTxInfo) {
		let bid = this._bids[buying_data.bid_idx];
		if (!bid || !bid.cards) return;
		let quantity_remaining = bid.cards[buying_data.card_detail_id].quantity;
		delete this._buyingAccountNumber[buying_data.card_id];
		console.log(
			chalk.bold.green(
				`
${acc} has bought ${buying_data.card_id} (${quantity_remaining} left)
amount paid: ${tx_result.total_dec / tx_result.num_cards} DEC / ${tx_result.total_usd / tx_result.num_cards} USD
https://hivehub.dev/tx/${tx.id}`
			)
		);

		if (!bid.sell_for_pct_more || bid.sell_for_pct_more <= 0) {
			return;
		}

		console.dir(buying_data.buy_price, { depth: null, maxArrayLength: null });

		const trade = this._activeTrades.CreateTrade(acc, buying_data, tx, bid, tx_result);
		const sellPrice = trade.sell!.usd;

		sell.add_CARDS(acc, [
			{
				cards: [buying_data.card_id],
				currency: 'USD',
				price: sellPrice,
				fee_pct: 600,
				list_fee: 1,
				list_fee_token: 'DEC',
			},
		]);

		console.log('');
		console.log(
			chalk.bold.blue(
				`${acc} will be selling ${buying_data.card_id} for: $${sellPrice} (profit: $${trade.profit_usd})`
			)
		);
	}

	async get_transaction_results(tx_ids: string[]) {
		let transactions = [];

		for (let t = 0; t < tx_ids.length; t++) {
			const id = tx_ids[t];
			for (let i = 0; i < 10; i++) {
				let tr = await market.getTransaction(id);
				if (tr?.trx_info != undefined) {
					transactions.push(tr);
					break;
				}

				await sleep(3000);
			}
		}

		return transactions;
	}

	async check_buying_result(acc: string, buying_cards: { data: CardToBuy[]; tx_ids: string[] }) {
		let transactions: { trx_info: BuyTxInfo }[] = await this.get_transaction_results(buying_cards.tx_ids);

		let isSuccess = false;
		if (transactions.some((t) => t.trx_info?.success)) {
			let tx = transactions.find((t) => t.trx_info?.success)?.trx_info;
			if (!tx) return;
			let tx_result = JSON.parse(tx.result) as BuyTxResult;
			buying_cards.data.forEach((buying_data) => {
				if (!tx_result.by_seller[0].items.includes(buying_data.seller_tx_id)) {
					this.revert_balance_and_quantities(acc, buying_data);
					return;
				}

				this.handle_success(acc, buying_data, tx_result, tx as BuyTxInfo);
			});

			this.getCurrentBalance(acc);
			isSuccess = true;
		} else {
			buying_cards.data.forEach((failed_buy) => {
				this.revert_balance_and_quantities(acc, failed_buy);
			});
		}

		if (isSuccess) return;

		let threeBlockErrorCount = 0;
		console.log('');
		transactions.forEach((tr) => {
			if (tr.trx_info?.error.includes('3 blocks')) threeBlockErrorCount++;
			console.log(chalk.bold.red(`${tr.trx_info?.id} - ${tr.trx_info?.error}`), tr.trx_info?.block_num);
		});
	}

	async create_buy_trx(acc: string, jsondata: unknown, timestamp: number, block: number) {
		let txPromises: Promise<any>[] = [];
		let txCount = 1;
		let currentBlock = 0;
		let passed = 0;

		while (passed < 10.5 && currentBlock < block + 2) {
			let res = hive.buy_cards(acc, jsondata).catch((e) => {
				console.log('ERROR in hive.buy_cards:', e);
				return null;
			});
			txPromises.push(res);

			passed = (Date.now() - timestamp) / 1000;
			console.log(txCount, passed, block, currentBlock, acc);
			currentBlock = await hive.getBlockNum();
			txCount++;
			if (passed < 8) await sleep((8 - passed + Math.random() / 10) * 1000);
		}

		return txPromises;
	}

	async prepare_to_buy(acc: string, cards_to_buy: CardToBuy[], timestamp: number, block: number): Promise<void> {
		if (
			this._gameSettings.dec_price < this.CONSTS.MIN_DEC_PRICE &&
			this.settings.global_params.accounts[acc].currency === 'DEC'
		) {
			console.log(
				chalk.bold.red(`${acc} will not buy because DEC price is too low (${this._gameSettings.dec_price})`)
			);
			return;
		}

		cards_to_buy = cards_to_buy
			.filter(Boolean)
			.filter((o) => Object.keys(o).length > 0 && o.price <= this._usdBalances[acc]);
		if (!cards_to_buy.length) return;

		let totalPrice = cards_to_buy.reduce((sum, card) => sum + card.price, 0);
		this._usdBalances[acc] -= totalPrice;

		let jsondata = {
			items: cards_to_buy.map((r) => r.seller_tx_id),
			price: totalPrice,
			currency: this.settings.global_params.accounts[acc].currency,
		};

		let tx_promises = await this.create_buy_trx(acc, jsondata, timestamp, block);
		await sleep(2000);

		Promise.all(tx_promises).then((tx) => {
			tx = tx.filter(Boolean);
			let tx_ids: string[] = tx.map((t) => {
				console.log(chalk.bold.yellow(`Trx: https://hivehub.dev/tx/${t.id}`));
				return t.id;
			});

			cards_to_buy.forEach(
				(c) => (this._buyingAccountNumber[c.card_id] = (this._buyingAccountNumber[c.card_id] || 0) + 1)
			);

			let buying = { data: cards_to_buy, tx_ids: tx_ids };
			this.check_buying_result(acc, buying).catch((e) =>
				console.log(chalk.bold.red('error occurred in check_buying_result: ' + e))
			);
		});
	}

	async check_desired(listing: SellCards, trx_id: string): Promise<CardToBuy> {
		let result = {} as CardToBuy;
		let price = Number(listing.price) || 0;
		if (price < (this.settings.global_params.min_profit_usd || 0.01)) return result;

		let card_id_parts = listing.cards.length ? listing.cards[0].match(/.+-(\d+)-.+/) : null;
		let card_id = card_id_parts ? parseInt(card_id_parts[1]) : 0;
		if (!card_id) return result;

		if (!this._lookingForCards.includes(card_id.toString())) return result;

		let card = {
				card_detail_id: card_id,
				uid: listing.cards[0],
				xp: 1,
				gold: listing.cards[0][0] == 'G',
				edition: 0,
			},
			card_cp = 0;

		try {
			for (let indx = 0; indx < this._bids.length; indx++) {
				const bid = this._bids[indx];
				if (!bid.cards) return result;
				let remaining = bid.cards[card_id],
					bcx = 0;

				if (!bid.cards[card_id]) continue;
				if ((remaining.quantity || 0) <= 0) continue;
				if (!bid.gold_only && card.gold) continue;
				if (bid.gold_only && !card.gold) continue;
				if (!bid.prices) continue;

				if ((remaining.bcx || 0) > 0 || (bid.min_cp_per_usd || 0) > 0 || bid.bellow_burn_value) {
					bcx = 1;

					if (price > (bid.prices[card_id].low_price as number) * 1.5) {
						if (this._slApiCallsPerMinute > 50) continue;
						this._slApiCallsPerMinute++;
						process.stdout.write('|');
						let card_full_info = card.edition ? card : (await cardsApi.findCardInfo([card.uid]))[0];
						if (!card_full_info?.edition) continue;
						card = card_full_info;
						bcx = cardsApi.calc_bcx(card, this._cardDetails, this._gameSettings);
					}

					if (price > (bid.prices[card_id].low_price || 0) * bcx) continue;
					if (
						(bid.cards[card_id].max_bcx || 0) > 0 &&
						bcx > Math.min(remaining.quantity as number, remaining.bcx as number)
					)
						continue;
					card_cp = card_cp || cardsApi.calc_cp(card, bcx, this._cardDetails, this._gameSettings);
					if ((bid.min_cp_per_usd || 0) > 0 && card_cp / price < (bid.min_cp_per_usd || 0)) continue;
					let dec_price = Math.min(readSettings().dec_price, 0.001);
					if (bid.bellow_burn_value && (!dec_price || price / dec_price > card_cp * 0.95)) continue;
					bid.bellow_burn_value &&
						console.log(indx, 'dec_price', dec_price, '-', price / dec_price, 'card_cp:', card_cp);
				}

				//this is only active when auto_set_buy_price = true or max_bcx_price > 0
				if (bid.prices[card_id].buy_price > 0 && price > bid.prices[card_id].buy_price * (bcx || 1)) continue;

				remaining.quantity = (remaining.quantity || 1) - (bcx || 1);

				result = {
					seller_tx_id: trx_id,
					bid_idx: indx,
					fee_pct: listing.fee_pct || 6,
					card_id: listing.cards[0],
					card_detail_id: card_id,
					card_name: this._cardDetails.find((x: any) => x.id == card.card_detail_id).name,
					bcx: bcx,
					card_cp: card_cp,
					price: Number(price),
					buy_price: bid.prices[card_id],
				};
				break;
			}
		} catch (e: Error | any) {
			console.log(chalk.bold.red('error occurred in check_desired: ' + e));
		}

		process.stdout.write(Object.values(sell.get_CARDS()).flat().length.toString());
		return result;
	}

	async process(operation: { op: any[]; trx_id: string; timestamp: string; block: number }) {
		if (operation.op[0] != 'custom_json') return;
		//process.stdout.write('.');

		let op = operation.op[1];
		if (op.id != 'sm_sell_cards' || this._accounts.includes(op.required_auths[0])) return;

		let parsedJson = JSON.parse(op.json);
		let listings = [parsedJson];
		if (Array.isArray(parsedJson)) listings = [...parsedJson];

		const bidQuantities = this._bids.map((b) => b.max_quantity || 0);
		const minMaxCards = Math.min(Math.max(...bidQuantities), 10);
		if (listings.length > minMaxCards) {
			let cardCounts = listings.reduce((prev, curr) => {
				let cid_parts = curr.cards[0].match(/([C|G]).+-(\d+)-.+/);
				if (!cid_parts) return prev;
				let cid = cid_parts[1] + cid_parts[2];
				prev[cid] = prev[cid] ? prev[cid] + 1 : 1;
				return prev;
			}, {});
			if (Object.values(cardCounts).some((quantity) => Number(quantity) > minMaxCards)) return;
		}

		let promises: Promise<CardToBuy>[] = [];
		for (let index = 0; index < listings.length; index++) {
			const listing = listings[index];

			let res = this.check_desired(listing, operation.trx_id + '-' + index).catch((e) => {
				console.log('ERROR in check_desired:', e);
				return {} as CardToBuy;
			});
			promises.push(res);
		}

		Promise.all(promises).then(async (cards_to_buy) => {
			cards_to_buy = cards_to_buy.filter((o) => Object.keys(o).length > 0);
			if (!cards_to_buy.length) return;

			console.log(cards_to_buy);

			for (let i = 0; i < this._accounts.length; i++) {
				const acc = this._accounts[i];
				this.prepare_to_buy(
					acc,
					[...cards_to_buy],
					new Date(operation.timestamp + 'Z').getTime(),
					operation.block
				).catch((e) => {
					console.log('ERROR in prepare_to_buy:', e);
				});
				await sleep(100);
			}
		});
	}

	async start(operation: { op: any[]; trx_id: string; timestamp: string; block: number }) {
		this.run_job(this.settings.global_params.fetch_market_price_delay).catch((e) => {
			console.log('ERROR in run_job:', e);
			this._lastChecked = 0;
		});

		if (Date.now() - this._minuteTimer > 1 * 60 * 1000) {
			this._slApiCallsPerMinute = 0;
			this._minuteTimer = Date.now();
		}

		this.process(operation).catch((e) => {
			console.log('ERROR in process:', e);
		});
	}
}
