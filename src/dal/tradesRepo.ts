import { MongoClient } from 'mongodb';
import { MarketPrice } from '../types/trade';
import * as repo from './repo';
import type { WithId, Document } from 'mongodb';

export interface Trade extends WithId<Document> {
	account: string;
	uid: string;
	card_id: number;
	card_name: string;
	bcx: number;
	xp?: number;
	create_date: string;
	edit_date?: string;
	sell_date?: string;
	status_id: number;
	status: string;
	profit_usd: number;
	profit_margin: number;
	bid_idx: number;
	bid_desc?: string;
	buy: {
		tx_id: string;
		usd: number;
		dec: number;
		market_price: MarketPrice;
	};
	sell: null | {
		usd: number;
		tx_count: number;
		break_even: number;
		tx_id?: string;
	};
}

type TotalProfit = {
	_id: any;
	profit_usd: number;
	profit_month: number;
	sold_cards: number;
	edit_date?: string;
	unsold: {
		cards: number;
		usd: number;
		profit: number;
	};
	monthly: {
		[x: string]: number;
	};
};

const insertTrade = async (client: MongoClient, data: Partial<Trade>) => {
	data.edit_date = new Date().toISOString();
	await repo.insertOne(client, 'Trades', data);
};

const findTradeByCardId = async (client: MongoClient, uid: string) => {
	let trades = await repo.find(client, 'Trades', { uid: uid });
	let trade = trades.length === 1 ? trades[0] : null;
	return trade as Trade;
};

const updateTrade = async (client: MongoClient, data: Trade) => {
	data.edit_date = new Date().toISOString();
	await repo.updateOne(client, 'Trades', { _id: data._id }, data);
};

const findActiveTrades = async (client: MongoClient, skip = 0, limit = 1000) => {
	let trades = await repo.find(client, 'Trades', { status_id: 0 }, {}, skip, limit).catch((e) => null);
	return trades as Trade[];
};

const findTotalProfit = async (client: MongoClient): Promise<TotalProfit> => {
	let profit = await repo.find(client, 'Trades', { _id: 'TOTAL' });
	return (profit[0] as TotalProfit) || { _id: 'TOTAL', profit_usd: 0, sold_cards: 0 };
};

const updateTotals = async (client: MongoClient, profit: number) => {
	let totalProfit = await findTotalProfit(client);
	totalProfit.sold_cards += profit ? 1 : 0;
	totalProfit.profit_usd += profit;
	totalProfit.monthly = totalProfit?.monthly || {};

	let active = await findActiveTrades(client);
	totalProfit.unsold = {
		cards: active.length,
		usd: active.reduce((partialSum, a) => partialSum + a.buy.usd, 0),
		profit: active.reduce((partialSum, a) => partialSum + a.profit_usd, 0),
	};

	let d = new Date();
	totalProfit.edit_date = d.toISOString();
	let currDateKey = new Date(d.setDate(2)).toISOString().substring(0, 7);
	totalProfit.monthly[currDateKey] = totalProfit.monthly[currDateKey] + profit || profit;
	totalProfit.profit_month = totalProfit.monthly[currDateKey];

	await repo.updateOne(client, 'Trades', { _id: 'TOTAL' }, totalProfit);
};

const reCalculateTotals = async (client: MongoClient): Promise<void> => {
	let finishedTrades = await repo.find(client, 'Trades', { status_id: 1 });
	let totalProfit: Partial<TotalProfit> = { sold_cards: 0, profit_usd: 0 };
	totalProfit.monthly = totalProfit?.monthly || {};

	for (let i = 0; i < finishedTrades.length; i++) {
		const trade = finishedTrades[i];
		totalProfit.sold_cards = (totalProfit.sold_cards || 0) + 1;
		totalProfit.profit_usd += trade.profit_usd;

		if (!trade.sell_date) continue;
		let d = new Date(trade.sell_date);
		let dateKey = new Date(d.setDate(1)).toISOString().substring(0, 7);
		totalProfit.monthly[dateKey] = totalProfit.monthly[dateKey] + trade.profit_usd || trade.profit_usd;
	}

	await repo.updateOne(client, 'Trades', { _id: 'TOTAL' }, totalProfit);
	await updateTotals(client, 0);
};

const finishTrade = async (client: MongoClient, trade: Trade): Promise<void> => {
	trade.status = 'Finished';
	trade.status_id = 1;
	trade.sell_date = new Date().toISOString();

	await updateTrade(client, trade);
	await updateTotals(client, trade.profit_usd);
};

const closeTrade = async (client: MongoClient, trade: Trade): Promise<void> => {
	trade.status = 'Closed - (combined or burned)';
	trade.status_id = 2;
	trade.sell = null;
	trade.profit_margin = 0;
	trade.profit_usd = 0;
	await updateTrade(client, trade);
	await updateTotals(client, 0);
};

export {
	insertTrade,
	updateTrade,
	findTradeByCardId,
	findActiveTrades,
	findTotalProfit,
	updateTotals,
	reCalculateTotals,
	finishTrade,
	closeTrade,
};
