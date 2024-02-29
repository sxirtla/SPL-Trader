import { MongoClient } from 'mongodb';
import { GlobalParams } from '../types/trade';
import * as market from '../api/market';
jest.mock('./../api/market');

import * as hive from '../api/hive';
jest.mock('./../api/hive');

import * as tradesRepo from '../dal/tradesRepo';
jest.mock('./../dal/tradesRepo');

import * as cardsApi from '../api/cards';
jest.mock('./../api/cards');

import * as user from '../api/user';
jest.mock('./../api/user');

let ActiveTrades = require('./../api/activeTrades').default;

describe('ActiveTrades', () => {
	let defaultAccount = 'THIEF_BESTBOOM';

	let marketPrices: market.MarketData[] = [];

	beforeEach(async () => {
		jest.clearAllMocks();
		jest.isolateModules(() => {
			//need to reset last_checked_trades variable
			ActiveTrades = require('./../api/activeTrades').default;
		});

		marketPrices = [
			{ card_detail_id: 123, low_price_bcx: 1, low_price: 2, gold: false },
			{ card_detail_id: 321, low_price_bcx: 3, low_price: 4, gold: true },
		] as market.MarketData[];
	});

	it('should call findActiveTrades once if there are no active trades', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(Promise.resolve([]));

		//Act
		let trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(1);
	});

	it('should call findCardInfo on active trades', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', xp: 1 },
				{ uid: 'C7-321-dcba', xp: 1 },
			] as tradesRepo.Trade[])
		);
		let findCardInfoSpy = jest
			.spyOn(cardsApi, 'findCardInfo')
			.mockReturnValue(Promise.resolve([{ player: defaultAccount, xp: 1, market_listing_type: 'sell' }]));
		let updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		let trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledTimes(0);
	});

	it('should update xp on active trades if it is not set', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', account: defaultAccount },
				{ uid: 'C7-321-dcba', account: defaultAccount },
			] as tradesRepo.Trade[])
		);
		let findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', player: defaultAccount, xp: 1, market_listing_type: 'sell' },
				{ uid: 'C7-321-dcba', player: defaultAccount, xp: 1, market_listing_type: 'sell' },
			])
		);
		let updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		let trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledTimes(2);
	});

	it('should call finishTrade based on sold card count', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', xp: 1, buy: { usd: 9 }, sell: {} },
				{ uid: 'C7-321-dcba', xp: 1, buy: { usd: 5 }, sell: {} },
			] as tradesRepo.Trade[])
		);
		let findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', player: 'other' },
				{ uid: 'C7-321-dcba', player: 'other' },
			])
		);
		let findCardSellPriceSpy = jest.spyOn(cardsApi, 'findCardSellPrice').mockReturnValue(Promise.resolve(10));
		let finishTradeSpy = jest.spyOn(tradesRepo, 'finishTrade');
		let transferFeeSpy = jest.spyOn(user, 'transferFee');

		//Act
		let trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(finishTradeSpy).toHaveBeenCalledTimes(2);
		expect(findCardSellPriceSpy).toHaveBeenCalledTimes(2);
		expect(finishTradeSpy).toHaveBeenLastCalledWith(
			{},
			{
				buy: { usd: 5 },
				profit_margin: 45.5,
				profit_usd: 4.55,
				sell: { break_even: 5.16, usd: 10 },
				uid: 'C7-321-dcba',
				xp: 1,
			}
		);
		expect(transferFeeSpy).toHaveBeenCalledTimes(2);
	});

	it('should call closeTrade if card was combined or burned', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', xp: 1, account: defaultAccount },
				{ uid: 'C7-321-dcba', xp: 1, account: defaultAccount },
			] as tradesRepo.Trade[])
		);
		let findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', player: defaultAccount, combined_card_id: 'C7-123-comb' },
				{ uid: 'C7-321-dcba', player: defaultAccount, xp: 2 },
			])
		);
		let closeTradeSpy = jest.spyOn(tradesRepo, 'closeTrade');

		//Act
		let trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(closeTradeSpy).toHaveBeenCalledTimes(2);
	});

	it('should push object to selling_cards if card is not on the market', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{
					uid: 'C7-123-abcd',
					card_id: 123,
					xp: 1,
					account: defaultAccount,
					bcx: 0,
					buy: { usd: 0.5 },
					sell: {  },
				},
				{
					uid: 'C7-321-dcba',
					card_id: 321,
					xp: 1,
					account: defaultAccount,
					bcx: 0,
					buy: { usd: 1 },
					sell: {  },
				},
			] as tradesRepo.Trade[])
		);
		let findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', player: defaultAccount, xp: 1, gold: false },
				{ uid: 'C7-321-dcba', player: defaultAccount, xp: 1, gold: true },
			])
		);
		let updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		let trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check(marketPrices);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledTimes(2);
		//expect(sell.get_CARDS()[defaultAccount].length).toBe(2);
	});

	it('should update card price if other cards are selling for 5% less', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{
					uid: 'C7-123-abcd',
					card_id: 123,
					xp: 1,
					account: defaultAccount,
					bcx: 0,
					buy: { usd: 0.5 },
					sell: { tx_count: 1 },
				},
			] as tradesRepo.Trade[])
		);
		let findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{
					uid: 'C7-123-abcd',
					player: defaultAccount,
					xp: 1,
					gold: false,
					market_id: 'market5',
					market_listing_type: 'SELL',
					details: { rarity: 4 },
				},
			])
		);
		let getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-dcba', buy_price: 1, xp: 1, market_id: 'market0' },
				{ uid: 'C7-123-qwee', buy_price: 1, xp: 1, market_id: 'market1' },
				{ uid: 'C7-123-efgh', buy_price: 1, xp: 1, market_id: 'market2' },
				{ uid: 'C7-123-grrd', buy_price: 1.01, xp: 1, market_id: 'market3' },
				{ uid: 'C7-123-qdfg', buy_price: 1.05, xp: 1, market_id: 'market4' },
				{ uid: 'C7-123-abcd', buy_price: 1.5, xp: 1, market_id: 'market5' },
			])
		);
		let updateCardPriceSpy = jest
			.spyOn(hive, 'update_card_price')
			.mockReturnValue(Promise.resolve({ id: 'txid1', block_num: 0, expired: false, trx_num: 0 }));
		let updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		let trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
		await trades.Check(marketPrices);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(getCardPricesSpy).toHaveBeenCalledTimes(1);
		expect(updateCardPriceSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledWith(
			{},
			{
				account: defaultAccount,
				bcx: 0,
				buy: {
					usd: 0.5,
				},
				card_id: 123,
				profit_margin: 45.451,
				profit_usd: 0.454,
				sell: {
					break_even: 0.516,
					tx_count: 2,
					tx_id: 'txid1',
					usd: 0.999,
				},
				uid: 'C7-123-abcd',
				xp: 1,
			}
		);
	});

	it('should not update card price if pos is high and price difference is < 5%', async () => {
		//Arrange
		let findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{
					uid: 'C7-123-abcd',
					card_id: 123,
					xp: 1,
					account: defaultAccount,
					bcx: 0,
					buy: { usd: 0.5 },
					sell: { tx_count: 1 },
				},
			] as tradesRepo.Trade[])
		);
		let findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{
					uid: 'C7-123-abcd',
					player: defaultAccount,
					xp: 1,
					gold: false,
					market_id: 'market3',
					market_listing_type: 'SELL',
					details: { rarity: 4 },
				},
			])
		);
		let getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-dcba', buy_price: 1, xp: 1, market_id: 'market0' },
				{ uid: 'C7-123-qwee', buy_price: 1.01, xp: 1, market_id: 'market1' },
				{ uid: 'C7-123-efgh', buy_price: 1.02, xp: 1, market_id: 'market2' },
				{ uid: 'C7-123-abcd', buy_price: 1.03, xp: 1, market_id: 'market3' },
			])
		);
		let updateCardPriceSpy = jest.spyOn(hive, 'update_card_price');
		let updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		let trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
		await trades.Check(marketPrices);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(getCardPricesSpy).toHaveBeenCalledTimes(1);
		expect(updateCardPriceSpy).not.toHaveBeenCalled();
		expect(updateTradeSpy).not.toHaveBeenCalled();
	});
});
