import chalk from 'chalk';
import * as hive from './hive';
import { GameSettings, LocalSettings, SellCards, CardToBuy, BuyTxInfo, BuyTxResult } from '../types/trade';
import { MongoClient } from 'mongodb';

import { sleep } from '../utility/helper';
import * as market from './market';
import * as cardsApi from './cards';
import { readSettings } from './settings';
import * as tradesRepo from './../dal/tradesRepo';
import { getUsableBalance } from './user';
import { generateBidPrices, setupBids } from './bids';
import { manage_rc } from './rc';
import * as sell from './sell';
import ActiveTrades from './activeTrades';

export default class Trade {
	private game_settings: GameSettings;
	private looking_for_cards: string[] = [];
	private accounts: string[] = [];
	private usd_balances: { [x: string]: number } = {};
	private bids = this.settings.bids;
	private last_checked = 0;
	private minute_timer = 0;
	private sl_api_calls_per_minute = 0;
	private buying_account_number: { [x: string]: number } = {};
	private transaction_delay = 200;
	private activeTrades: ActiveTrades;

	constructor(private settings: LocalSettings, private card_details: any, private mongoClient: MongoClient) {
		this.game_settings = readSettings();
		this.accounts = Object.keys(settings.global_params.accounts);
		hive.init(settings.global_params.preferred_hive_node);
		hive.generateKey(settings.global_params);
		this.activeTrades = new ActiveTrades(mongoClient, settings.global_params);
	}

	async get_current_balance(acc: string) {
		this.game_settings = readSettings();

		let balance = await getUsableBalance(acc, this.settings.global_params.accounts[acc]);

		this.usd_balances[acc] =
			this.settings.global_params.accounts[acc].currency == 'DEC'
				? Number((balance * this.game_settings.dec_price).toFixed(3))
				: Number((balance / 1000).toFixed(3));

		return;
	}

	async get_marketData_and_update_bid_prices() {
		console.log(new Date().toLocaleTimeString('en-US', { hour12: false }), '- fetching market prices...');
		let prices = await market.getPrices();
		const pm_bids = await market.getBids();
		if (prices.length === 0 || !pm_bids) {
			return null;
		}
		for (const bid of this.bids) {
			if (!bid.prices) bid.prices = {};

			generateBidPrices(bid, pm_bids, prices, this.settings.global_params);
		}

		console.log(new Date().toLocaleTimeString('en-US', { hour12: false }), '- done');
		return prices;
	}

	async run_job(delay: number = 5) {
		if (Date.now() - this.last_checked < delay * 60 * 1000) return;

		this.last_checked = Date.now();

		//await tradesRepo.reCalculateTotals(this.mongoClient);

		for (let i = 0; i < this.accounts.length; i++) {
			const acc = this.accounts[i];
			await this.get_current_balance(acc);
			await manage_rc(acc, this.settings.global_params);
		}

		console.log('');
		console.log(this.usd_balances);

		let marketData = await this.get_marketData_and_update_bid_prices();

		await sell.sell_cards(this.mongoClient).catch((e) => console.log('error in sell_cards:', e));

		await this.activeTrades.Check(marketData);
	}

	revert_balance_and_quantities(acc: string, buy: CardToBuy) {
		this.usd_balances[acc] += buy.price;

		this.buying_account_number[buy.card_id] -= 1;
		if (this.buying_account_number[buy.card_id] === 0) {
			let bid = this.bids[buy.bid_idx];
			if (!bid || !bid.cards) return;
			bid.cards[buy.card_detail_id].quantity = (bid.cards[buy.card_detail_id].quantity || 0) + (buy.bcx || 1);
			delete this.buying_account_number[buy.card_id];
			console.log('quantity restored to:', bid.cards[buy.card_detail_id].quantity?.toString());
		}
	}

	handle_success(acc: string, buying_data: CardToBuy, tx_result: BuyTxResult, tx: BuyTxInfo) {
		let bid = this.bids[buying_data.bid_idx];
		if (!bid || !bid.cards) return;
		let quantity_remaining = bid.cards[buying_data.card_detail_id].quantity;
		delete this.buying_account_number[buying_data.card_id];
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

		let card_detail_id = buying_data.card_detail_id;
		console.dir(buying_data.buy_price, { depth: null, maxArrayLength: null });
		let marketPrice = buying_data.bcx > 1 ? buying_data.buy_price.low_price_bcx : buying_data.buy_price.low_price;
		const sellPrice = sell.calculate_sellPrice(marketPrice as number, buying_data.price, bid.sell_for_pct_more);

		sell.add_CARDS(acc, [
			{
				cards: [buying_data.card_id],
				currency: 'USD',
				price: Number(sellPrice.toFixed(4)),
				fee_pct: 600,
				list_fee: 1,
				list_fee_token: 'DEC',
			},
		]);

		let trade: Partial<tradesRepo.Trade> = {
			account: acc,
			uid: buying_data.card_id,
			card_id: card_detail_id,
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
		};

		sell.calculate_profit(trade, sellPrice);

		tradesRepo.insertTrade(this.mongoClient, trade).catch((e) => console.log('Trade insert failed:', e));

		console.log('');
		console.log(
			chalk.bold.blue(`will be selling ${buying_data.card_id} for: $${sellPrice} (profit: $${trade.profit_usd})`)
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

			this.get_current_balance(acc);
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

		if (!isSuccess && threeBlockErrorCount === 5) this.transaction_delay += 10;
		else if (!isSuccess && threeBlockErrorCount > 0 && threeBlockErrorCount < 4) this.transaction_delay -= 10;

		console.log(this.transaction_delay);
	}

	async create_buy_trx(acc: string, jsondata: unknown, timestamp: number) {
		let tx_promises: Promise<any>[] = [];
		for (let i = 0; i < 5; i++) {
			let res = hive.buy_cards(acc, jsondata).catch((e) => {
				console.log('ERROR in hive.buy_cards:', e);
				return null;
			});
			tx_promises.push(res);

			let passed = (Date.now() - timestamp) / 1000;
			console.log(i, passed, acc);
			if (passed > 10) break;
			await sleep(this.transaction_delay);
		}
		return tx_promises;
	}

	async prepare_to_buy(acc: string, cards_to_buy: CardToBuy[], timestamp: number, block: number): Promise<void> {
		cards_to_buy = cards_to_buy
			.filter(Boolean)
			.filter((o) => Object.keys(o).length > 0 && o.price <= this.usd_balances[acc]);
		if (!cards_to_buy.length) return;
		let totalPrice = cards_to_buy.reduce((sum, card) => sum + card.price, 0);
		this.usd_balances[acc] -= totalPrice;

		let jsondata = {
			items: cards_to_buy.map((r) => r.seller_tx_id),
			price: totalPrice + 0.0011,
			currency: this.settings.global_params.accounts[acc].currency,
		};

		let tx_promises = await this.create_buy_trx(acc, jsondata, timestamp);

		let currentBlock = await hive.getBlockNum();
		console.log(acc, 'blocks:', block, ' - ', currentBlock);
		if (block + 2 >= currentBlock) {
			while (block + 2 > currentBlock) {
				await sleep(100);
				currentBlock = await hive.getBlockNum();
			}

			tx_promises.push(...(await this.create_buy_trx(acc, jsondata, timestamp)));
		}
		await sleep(2000);

		Promise.all(tx_promises).then((tx) => {
			tx = tx.filter(Boolean);
			let tx_ids: string[] = tx.map((t) => {
				console.log(chalk.bold.yellow(`Trx: https://hivehub.dev/tx/${t.id}`));
				return t.id;
			});

			cards_to_buy.forEach(
				(c) => (this.buying_account_number[c.card_id] = (this.buying_account_number[c.card_id] || 0) + 1)
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

		if (!this.looking_for_cards.includes(card_id.toString())) return result;

		let card = {
				card_detail_id: card_id,
				uid: listing.cards[0],
				xp: 1,
				gold: listing.cards[0][0] == 'G',
				edition: 0,
			},
			card_cp = 0;

		try {
			for (let indx = 0; indx < this.bids.length; indx++) {
				const bid = this.bids[indx];
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
						if (this.sl_api_calls_per_minute > 50) continue;
						this.sl_api_calls_per_minute++;
						process.stdout.write('|');
						let card_full_info = card.edition ? card : (await cardsApi.findCardInfo([card.uid]))[0];
						if (!card_full_info?.edition) continue;
						card = card_full_info;
						bcx = cardsApi.calc_bcx(card, this.card_details, this.game_settings);
					}

					if (price > (bid.prices[card_id].low_price || 0) * bcx) continue;
					if (
						(bid.cards[card_id].max_bcx || 0) > 0 &&
						bcx > Math.min(remaining.quantity as number, remaining.bcx as number)
					)
						continue;
					card_cp = card_cp || cardsApi.calc_cp(card, bcx, this.card_details, this.game_settings);
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
					card_id: listing.cards[0],
					card_detail_id: card_id,
					card_name: this.card_details.find((x: any) => x.id == card.card_detail_id).name,
					bcx: bcx,
					card_cp: card_cp,
					price: Number(price),
					fee_pct: listing.fee_pct || 6,
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
		if (op.id != 'sm_sell_cards' || this.accounts.includes(op.required_auths[0])) return;

		let parsedJson = JSON.parse(op.json);
		let listings = [parsedJson];
		if (Array.isArray(parsedJson)) listings = [...parsedJson];

		const bidQuantities = this.bids.map((b) => b.max_quantity || 0);
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

			this.accounts.forEach((acc) =>
				this.prepare_to_buy(
					acc,
					[...cards_to_buy],
					new Date(operation.timestamp + 'Z').getTime(),
					operation.block
				).catch((e) => {
					console.log('ERROR in prepare_to_buy:', e);
				})
			);
		});
	}

	async start(operation: { op: any[]; trx_id: string; timestamp: string; block: number }) {
		this.run_job(this.settings.global_params.fetch_market_price_delay).catch((e) => {
			console.log('ERROR in run_job:', e);
			this.last_checked = 0;
		});

		if (Date.now() - this.minute_timer > 1 * 60 * 1000) {
			this.sl_api_calls_per_minute = 0;
			this.minute_timer = Date.now();
		}

		this.process(operation).catch((e) => {
			console.log('ERROR in process:', e);
		});
	}

	setup() {
		this.bids = this.settings.bids;
		this.looking_for_cards = setupBids(this.bids, this.card_details);

		this.looking_for_cards = [...new Set(this.looking_for_cards)];
		// console.dir(this.bids, { depth: null, maxArrayLength: null });
	}
}
