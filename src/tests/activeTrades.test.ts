/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import { MongoClient } from 'mongodb';
import { GlobalParams } from '../types/trade';
import { TransactionConfirmation } from '@hiveio/dhive';
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
	const defaultAccount = 'THIEF_BESTBOOM';

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
		const findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(Promise.resolve([]));

		//Act
		const trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(1);
	});

	it('should call findCardInfo on active trades', async () => {
		//Arrange
		const findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', xp: 1 },
				{ uid: 'C7-321-dcba', xp: 1 },
			] as tradesRepo.Trade[])
		);
		const findCardInfoSpy = jest
			.spyOn(cardsApi, 'findCardInfo')
			.mockReturnValue(Promise.resolve([{ player: defaultAccount, xp: 1, market_listing_type: 'sell' }] as any));
		const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		const trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledTimes(0);
	});

	it('should update xp on active trades if it is not set', async () => {
		//Arrange
		const findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', account: defaultAccount },
				{ uid: 'C7-321-dcba', account: defaultAccount },
			] as tradesRepo.Trade[])
		);
		const findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{
					uid: 'C7-123-abcd',
					player: defaultAccount,
					xp: 1,
					market_listing_type: 'sell',
					bcx: 1,
					last_buy_price: '1',
					details: { name: 'test' },
				},
				{
					uid: 'C7-321-dcba',
					player: defaultAccount,
					xp: 1,
					market_listing_type: 'sell',
					bcx: 1,
					last_buy_price: '2',
					details: { name: 'test' },
				},
			] as any)
		);
		const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		const trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledTimes(2);
	});

	it('should call finishTrade based on sold card count', async () => {
		//Arrange
		const findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', xp: 1, buy: { usd: 9 }, sell: {} },
				{ uid: 'C7-321-dcba', xp: 1, buy: { usd: 5 }, sell: {} },
			] as tradesRepo.Trade[])
		);
		const findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', player: 'other' },
				{ uid: 'C7-321-dcba', player: 'other' },
			] as any)
		);
		const findCardSellPriceSpy = jest.spyOn(cardsApi, 'findCardSellPrice').mockReturnValue(Promise.resolve(10));
		const finishTradeSpy = jest.spyOn(tradesRepo, 'finishTrade');
		const transferFeeSpy = jest.spyOn(user, 'transferFee');

		//Act
		const trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
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
		const findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', xp: 1, account: defaultAccount },
				{ uid: 'C7-321-dcba', xp: 1, account: defaultAccount },
			] as tradesRepo.Trade[])
		);
		const findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', player: defaultAccount, combined_card_id: 'C7-123-comb' },
				{ uid: 'C7-321-dcba', player: defaultAccount, xp: 2 },
			] as any)
		);
		const closeTradeSpy = jest.spyOn(tradesRepo, 'closeTrade');

		//Act
		const trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check([]);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(closeTradeSpy).toHaveBeenCalledTimes(2);
	});

	it('should push object to selling_cards if card is not on the market', async () => {
		//Arrange
		const findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
			Promise.resolve([
				{
					uid: 'C7-123-abcd',
					card_id: 123,
					xp: 1,
					account: defaultAccount,
					bcx: 0,
					buy: { usd: 0.5 },
					sell: {},
				},
				{
					uid: 'C7-321-dcba',
					card_id: 321,
					xp: 1,
					account: defaultAccount,
					bcx: 0,
					buy: { usd: 1 },
					sell: {},
				},
			] as tradesRepo.Trade[])
		);
		const findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
			Promise.resolve([
				{ uid: 'C7-123-abcd', player: defaultAccount, xp: 1, gold: false },
				{ uid: 'C7-321-dcba', player: defaultAccount, xp: 1, gold: true },
			] as any)
		);
		const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

		//Act
		const trades = new ActiveTrades({} as MongoClient, {} as GlobalParams);
		await trades.Check(marketPrices);

		//Assert
		expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
		expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
		expect(updateTradeSpy).toHaveBeenCalledTimes(2);
		//expect(sell.get_CARDS()[defaultAccount].length).toBe(2);
	});

	describe('updateCardPrice', () => {

		let findActiveTradesSpy: jest.SpyInstance<Promise<tradesRepo.Trade[]>>;
		let findCardInfoSpy: jest.SpyInstance<Promise<cardsApi.CardInfo[]>>;
		let updateCardPriceSpy: jest.SpyInstance<Promise<TransactionConfirmation | null>>;

		beforeEach(() => {
			findActiveTradesSpy = jest.spyOn(tradesRepo, 'findActiveTrades').mockReturnValue(
				Promise.resolve([
					{
						uid: 'C7-123-abcd',
						card_id: 123,
						xp: 1,
						account: defaultAccount,
						bcx: 0,
						buy: { usd: 1 },
						sell: { tx_count: 1 },
					},
				] as tradesRepo.Trade[])
			);

			findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockReturnValue(
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
				] as any)
			);

			updateCardPriceSpy = jest
				.spyOn(hive, 'update_card_price')
				.mockReturnValue(Promise.resolve({ id: 'txid1', block_num: 0, expired: false, trx_num: 0 }));
		})

		it('should update card price if position is low', async () => {
			//Arrange
			const getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
				Promise.resolve([
					{ uid: 'C7-123-dcba', buy_price: 1.5, xp: 1, market_id: 'market0' },
					{ uid: 'C7-123-qwee', buy_price: 1.55, xp: 1, market_id: 'market1' },
					{ uid: 'C7-123-efgh', buy_price: 1.59, xp: 1, market_id: 'market2' },
					{ uid: 'C7-123-grrd', buy_price: 1.6, xp: 1, market_id: 'market3' },
					{ uid: 'C7-123-qdfg', buy_price: 1.7, xp: 1, market_id: 'market4' },
					{ uid: 'C7-123-abcd', buy_price: 2, xp: 1, market_id: 'market5' },
				] as any)
			);
			const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

			//Act
			const trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
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
						usd: 1,
					},
					card_id: 123,
					profit_margin: 29.29,
					profit_usd: 0.439,
					sell: {
						break_even: 1.032,
						tx_count: 2,
						tx_id: 'txid1',
						usd: 1.499,
					},
					uid: 'C7-123-abcd',
					xp: 1,
				}
			);
		});

		it('should update card price if other cards are selling for bellow break even', async () => {
			//Arrange
			const getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
				Promise.resolve([
					{ uid: 'C7-123-dcba', buy_price: 0.5, xp: 1, market_id: 'market0' },
					{ uid: 'C7-123-qwee', buy_price: 0.9, xp: 1, market_id: 'market1' },
					{ uid: 'C7-123-efgh', buy_price: 1, xp: 1, market_id: 'market2' },
					{ uid: 'C7-123-grrd', buy_price: 1.1, xp: 1, market_id: 'market3' },
					{ uid: 'C7-123-abcd', buy_price: 1.5, xp: 1, market_id: 'market4' },
				] as any)
			);
			const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

			//Act
			const trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
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
						usd: 1,
					},
					card_id: 123,
					profit_margin: 5.738,
					profit_usd: 0.063,
					sell: {
						break_even: 1.032,
						tx_count: 2,
						tx_id: 'txid1',
						usd: 1.099,
					},
					uid: 'C7-123-abcd',
					xp: 1,
				}
			);
		});

		it('should update card according to 8% rule', async () => {
			//Arrange
			const getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
				Promise.resolve([
					{ uid: 'C7-123-dcba', buy_price: 1.5, xp: 1, market_id: 'market0' },
					{ uid: 'C7-123-qwee', buy_price: 1.6, xp: 1, market_id: 'market1' },
					{ uid: 'C7-123-efgh', buy_price: 5, xp: 1, market_id: 'market2' },
					{ uid: 'C7-123-grrd', buy_price: 7, xp: 1, market_id: 'market3' },
					{ uid: 'C7-123-abcd', buy_price: 8, xp: 1, market_id: 'market4' },
				] as any)
			);
			
			const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

			//Act
			const trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
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
						usd: 1,
					},
					card_id: 123,
					profit_margin: 74.596,
					profit_usd: 3.729,
					sell: {
						break_even: 1.032,
						tx_count: 2,
						tx_id: 'txid1',
						usd: 4.999,
					},
					uid: 'C7-123-abcd',
					xp: 1,
				}
			);
		});

		it('should update card to break even if lots of cards on the market bellow be', async () => {
			//Arrange
			const getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
				Promise.resolve([
					{ uid: 'C7-123-dcba', buy_price: 0.1, xp: 1, market_id: 'market0' },
					{ uid: 'C7-123-qwee', buy_price: 0.2, xp: 1, market_id: 'market1' },
					{ uid: 'C7-123-efgh', buy_price: 0.3, xp: 1, market_id: 'market2' },
					{ uid: 'C7-123-grrd', buy_price: 0.4, xp: 1, market_id: 'market3' },
					{ uid: 'C7-123-grrd', buy_price: 0.5, xp: 1, market_id: 'market31' },
					{ uid: 'C7-123-grrd', buy_price: 0.6, xp: 1, market_id: 'market32' },
					{ uid: 'C7-123-grrd', buy_price: 0.7, xp: 1, market_id: 'market33' },
					{ uid: 'C7-123-grrd', buy_price: 0.8, xp: 1, market_id: 'market34' },
					{ uid: 'C7-123-grrd', buy_price: 0.9, xp: 1, market_id: 'market35' },
					{ uid: 'C7-123-grrd', buy_price: 1.5, xp: 1, market_id: 'market35' },
					{ uid: 'C7-123-abcd', buy_price: 2, xp: 1, market_id: 'market4' },
				] as any)
			);
			
			const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

			//Act
			const trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
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
						usd: 1,
					},
					card_id: 123,
					profit_margin: 29.29,
					profit_usd: 0.439,
					sell: {
						break_even: 1.032,
						tx_count: 2,
						tx_id: 'txid1',
						usd: 1.499,
					},
					uid: 'C7-123-abcd',
					xp: 1,
				}
			);
		});

		it('should not update card if all the cards bellow are less than break even', async () => {
			//Arrange
			const getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
				Promise.resolve([
					{ uid: 'C7-123-dcba', buy_price: 0.1, xp: 1, market_id: 'market0' },
					{ uid: 'C7-123-qwee', buy_price: 0.2, xp: 1, market_id: 'market1' },
					{ uid: 'C7-123-efgh', buy_price: 0.3, xp: 1, market_id: 'market2' },
					{ uid: 'C7-123-grrd', buy_price: 0.4, xp: 1, market_id: 'market3' },
					{ uid: 'C7-123-abcd', buy_price: 2, xp: 1, market_id: 'market4' },
					{ uid: 'C7-123-abcd', buy_price: 3, xp: 1, market_id: 'market5' },
				] as any)
			);
			
			const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

			//Act
			const trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
			await trades.Check(marketPrices);

			//Assert
			expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
			expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
			expect(getCardPricesSpy).toHaveBeenCalledTimes(1);
			expect(updateCardPriceSpy).not.toHaveBeenCalled();
			expect(updateTradeSpy).not.toHaveBeenCalled();
		});

		it('should not update card price if pos is low and price difference is < 5%', async () => {
			//Arrange
			const getCardPricesSpy = jest.spyOn(market, 'getCardPrices').mockReturnValue(
				Promise.resolve([
					{ uid: 'C7-123-dcba', buy_price: 1, xp: 1, market_id: 'market0' },
					{ uid: 'C7-123-qwee', buy_price: 1.01, xp: 1, market_id: 'market1' },
					{ uid: 'C7-123-abcd', buy_price: 1.03, xp: 1, market_id: 'market3' },
				] as any)
			);
			const updateTradeSpy = jest.spyOn(tradesRepo, 'updateTrade');

			//Act
			const trades = new ActiveTrades({} as MongoClient, { accounts: { defaultAccount: {} } });
			await trades.Check(marketPrices);

			//Assert
			expect(findActiveTradesSpy).toHaveBeenCalledTimes(2);
			expect(findCardInfoSpy).toHaveBeenCalledTimes(1);
			expect(getCardPricesSpy).toHaveBeenCalledTimes(1);
			expect(updateCardPriceSpy).not.toHaveBeenCalled();
			expect(updateTradeSpy).not.toHaveBeenCalled();
		});
	});
});
