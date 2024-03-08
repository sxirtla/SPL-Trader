import { MongoClient } from 'mongodb';
import * as hive from './hive';
import chalk from 'chalk';
import * as tradesRepo from '../dal/tradesRepo';

type SELLING_CARDS = {
	[account: string]: SELLING_CARD[];
};
type SELLING_CARD = {
	cards: string[];
	currency: string;
	price: number;
	fee_pct: number;
	list_fee: number;
	list_fee_token: string;
};
let CARDS = {} as SELLING_CARDS;

const get_CARDS = () => {
	return CARDS;
};

const add_CARDS = (account: string, cards: SELLING_CARD[]) => {
	CARDS[account] = CARDS[account] || [];
	CARDS[account].push(...cards);
};

const sell_cards = async (mongoClient: MongoClient) => {
	if (Object.values(CARDS).flat().length == 0) return;

	for (const account in CARDS) {
		const data = CARDS[account];
		let tx = await hive.sell_cards(account, data).catch((e) => {
			console.log('ERROR in hive.sell_cards:', e.message);
			return null;
		});

		if (!tx) continue;

		for (let i = 0; i < data.length; i++) {
			const card = data[i];

			console.log(chalk.bold.green(`${account} is selling ${card.cards[0]} for: ${card.price} USD`));

			let trade = await tradesRepo.findTradeByCardId(mongoClient, card.cards[0]);
			if (!trade.sell) continue;
			trade.sell.tx_id = tx.id;
			trade.sell.tx_count = (trade.sell.tx_count || 0) + 1;

			await tradesRepo.updateTrade(mongoClient, trade);
			await tradesRepo.updateTotals(mongoClient, 0);
		}

		delete CARDS[account];

		console.log(`Trx: https://hivehub.dev/tx/${tx.id}`);
	}
};

const calculate_profit = (trade: Partial<tradesRepo.Trade>, sellPrice: number) => {
	if (!sellPrice || !trade.sell || !trade.buy) return;

	trade.sell.usd = Number(sellPrice.toFixed(3));
	trade.sell.break_even = trade.sell.break_even || calculate_break_even(trade.buy.usd);
	let usdProfit = sellPrice * 0.94 - trade.buy.usd * 0.97;
	trade.profit_usd = Number(usdProfit.toFixed(3));
	trade.profit_margin = Number(((usdProfit / sellPrice) * 100).toFixed(3));
};

const calculate_sellPrice = (marketPrice: number, buyPrice: number, sell_for_pct_more: number = 10) => {
	let price = Math.max(
		marketPrice * 0.98,
		Number((marketPrice - 0.001).toFixed(3)),
		buyPrice * (1 + sell_for_pct_more / 100)
	);
	return Number(price.toFixed(3));
};

const calculate_break_even = (buyPrice: number) => Number(((buyPrice * 97) / 94).toFixed(3));

export { get_CARDS, add_CARDS, sell_cards, calculate_profit, calculate_sellPrice, calculate_break_even };
