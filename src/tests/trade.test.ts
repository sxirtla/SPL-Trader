/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient } from 'mongodb';
import { TransactionConfirmation } from '@hiveio/dhive';
import fs from 'fs';

import { CardToBuy, LocalSettings } from './../types/trade';
import * as cardsApi from './../api/cards';

jest.mock('./../api/settings', () => ({
	downloadGameSettings: jest.fn(() => Promise.resolve()),
	readSettings: jest.fn(() => {
		return {
			dec_price: 0.001,
			dec: {
				gold_burn_bonus: 50,
				gold_burn_bonus_2: 25,
				alpha_bonus: 0.1,
				gold_bonus: 0.1,
				burn_rate: [15, 60, 300, 1500],
				untamed_burn_rate: [10, 40, 200, 1000],
				alpha_burn_bonus: 2,
				promo_burn_bonus: 2,
				max_burn_bonus: 1.05,
				beta_bonus: 0.05,
			},
			alpha_xp: [20, 100, 250, 1000],
			gold_xp: [250, 500, 1000, 2500],
			beta_xp: [15, 75, 175, 750],
			beta_gold_xp: [200, 400, 800, 2000],
			combine_rates: [
				[1, 5, 14, 30, 60, 100, 150, 220, 300, 400],
				[1, 5, 14, 25, 40, 60, 85, 115],
				[1, 4, 10, 20, 32, 46],
				[1, 3, 6, 11],
			],
			combine_rates_gold: [
				[0, 0, 1, 2, 5, 9, 14, 20, 27, 38],
				[0, 1, 2, 4, 7, 11, 16, 22],
				[0, 1, 2, 4, 7, 10],
				[0, 1, 2, 4],
			],
			xp_levels: [
				[20, 60, 160, 360, 760, 1560, 2560, 4560, 7560],
				[100, 300, 700, 1500, 2500, 4500, 8500],
				[250, 750, 1750, 3750, 7750],
				[1000, 3000, 7000],
			],
		};
	}),
}));

let downloadCardDetails = cardsApi.downloadCardDetails as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
downloadCardDetails = jest.fn(() => Promise.resolve());

import * as user from '../api/user';
jest.mock('./../api/user');

import * as hive from '../api/hive';
jest.mock('./../api/hive');
const generateKeySpy = jest.spyOn(hive, 'generateKey');

import * as market from '../api/market';
jest.mock('./../api/market');

import Trade from './../api/trade';
import { sleep } from '../utility/helper';

describe('Trade', () => {
	const card_details_string = fs.readFileSync('./data/cardsDetails.json', { encoding: 'utf8' });
	const card_details = JSON.parse(card_details_string) as any[];
	let local_settings = {} as LocalSettings;

	beforeEach(() => {
		local_settings = {
			global_params: {
				mongo_url: 'fuck you BESTBOOM',
				accounts: {
					THIEF_BESTBOOM: {
						currency: 'CREDITS',
						minimum_balance: 0,
						active_key: 'fuck you BESTBOOM',
						posting_key: 'fuck you BESTBOOM',
					},
					FUCK_BESTBOOM: {
						currency: 'DEC',
						minimum_balance: 0,
						active_key: 'fuck you BESTBOOM',
						posting_key: 'fuck you BESTBOOM',
					},
				},
				min_profit_usd: 0.05,
				profit_fee_pct: 10,
				fetch_market_price_delay: 5,
			},
			bids: [],
		};
	});

	describe('setup', () => {
		it('should generate cards object after calling setup', () => {
			//AAA arange act assert
			local_settings.bids.push({
				id: 10,
				comment: 'Trade Chaos cards',
				editions: ['chaos'],
				rarities: ['rare'],
				elements: ['water'],
				types: ['summoner'],
				max_bcx_price: 5,
				sell_for_pct_more: 10,
				buy_pct_below_market: 20,
				auto_set_buy_price: true,
				max_quantity: 5,
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			trade.setup();

			//Assert
			expect(generateKeySpy).toHaveBeenCalled();
			expect(Object.keys(local_settings.bids[0].cards || {}).length).toBe(1);
			// @ts-expect-error Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[437]).toBeTruthy();
			// @ts-expect-error Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[437].bcx).toBe(0);
			// @ts-expect-error Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[437].quantity).toBe(5);
		});

		it('should remove bid if max_bcx_price, min_cp_per_usd, auto_set_buy_price or bellow_burn_value is not provided', () => {
			//Arange
			local_settings.bids.push({
				id: 10,
				comment: 'Grum Flameblade',
				cards: { 447: { max_quantity: 1 } },
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			trade.setup();

			//Assert
			expect(local_settings.bids.length).toBe(0);
		});

		it('should remove bid if max_quantity is not provided', () => {
			//Arange
			local_settings.bids.push({
				id: 10,
				comment: 'Grum Flameblade',
				cards: { 447: { max_bcx_price: 3 } },
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			trade.setup();

			//Assert
			expect(local_settings.bids.length).toBe(0);
		});

		it('should set max_quantity equal to max_bcx if max_quantity < max_bcx', () => {
			//Arange
			local_settings.bids.push({
				id: 10,
				comment: 'Grum Flameblade',
				cards: { 447: { max_bcx_price: 3, max_bcx: 5, max_quantity: 3 } },
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			trade.setup();

			//Assert
			// @ts-expect-error Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[447].max_quantity).toBe(5);
			// @ts-expect-error Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[447].quantity).toBe(5);
		});

		it('should not select older reward cards if only_modern = true', () => {
			//AAA arange act assert
			local_settings.bids.push({
				id: 10,
				comment: 'Trade Chaos cards',
				editions: ['reward'],
				rarities: ['legendary'],
				elements: ['fire'],
				types: ['monster'],
				max_bcx_price: 5,
				sell_for_pct_more: 10,
				buy_pct_below_market: 20,
				auto_set_buy_price: true,
				max_quantity: 5,
				only_modern: true,
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			trade.setup();

			//Assert
			// @ts-expect-error Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[222]).toBeFalsy();
			// @ts-expect-error Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[461]).toBeTruthy();
		});
	});

	describe('check_desired', () => {
		let _trade: any;
		beforeEach(async () => {
			const getUsableBalanceMock = user.getUsableBalance as jest.Mock;
			getUsableBalanceMock.mockImplementation((username: string, options: any) => 100000);

			local_settings.bids.push({
				id: 10,
				comment: 'Trade Chaos cards',
				editions: ['untamed'],
				rarities: ['common'],
				elements: ['water'],
				types: ['monster'],
				max_bcx_price: 5,
				sell_for_pct_more: 10,
				buy_pct_below_market: 20,
				auto_set_buy_price: true,
				max_quantity: 5,
				prices: {
					168: { buy_price: 0.5, low_price: 0.8 },
					169: { buy_price: 0.4, low_price: 0.7 },
					170: { buy_price: 0.3, low_price: 0.6 },
					171: { buy_price: 0.1, low_price: 0.12 },
				},
			});
			_trade = new Trade(local_settings, card_details, {} as MongoClient);
			_trade.setup();
			await _trade.get_current_balance(_trade.accounts[0]);
		});

		it('should succcessfully validate this listing', async () => {
			//aranged in before each
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].quantity = 1;

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-FA5C2EF9TC'], currency: 'USD', price: 0.48, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).not.toBe(null);
			expect(res.seller_tx_id).toBe('123456');
			expect(res.card_id).toBe('C4-168-FA5C2EF9TC');
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[168].quantity).toBe(0);
		});

		it('should return {} if price is not a valid number', async () => {
			//aranged in before each

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-FA5C2EF9TC'], currency: 'USD', price: 'NaN', fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if price is < 0.01', async () => {
			//aranged in before each

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-FA5C2EF9TC'], currency: 'USD', price: 0.009, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if card id is not correctly formatted', async () => {
			//aranged in before each

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4168-FA5C2EF9TC'], currency: 'USD', price: 0.5, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if card is not provided', async () => {
			//aranged in before each

			//Act
			const res = await _trade.check_desired(
				{ cards: [], currency: 'USD', price: 0.5, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if card id is not included in bids', async () => {
			//aranged in before each

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-1-FA5C2EF9TC'], currency: 'USD', price: 0.5, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if card quantity to buy is 0', async () => {
			//aranged in before each
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].quantity = 0;

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-FA5C2EF9TC'], currency: 'USD', price: 0.49, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if listing is golfoil and bid has gold_only set to false', async () => {
			//aranged in before each
			local_settings.bids[0].gold_only = false;

			//Act
			const res = await _trade.check_desired(
				{ cards: ['G4-168-FA5C2EF9TC'], currency: 'USD', price: 0.49, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if listing is regular foil and bid has gold_only set to true', async () => {
			//aranged in before each
			local_settings.bids[0].gold_only = true;

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-FA5C2EF9TC'], currency: 'USD', price: 0.49, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if listing price > buy_price', async () => {
			//aranged in before each

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-FA5C2EF9TC'], currency: 'USD', price: 0.6, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if listing price > max_bcx_price', async () => {
			//aranged in before each
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].max_bcx_price = 1;
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].prices[168].buy_price = 1;

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-FA5C2EF9TC'], currency: 'USD', price: 2, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(res).toStrictEqual({});
		});

		it('should return {} if listing bcx > cards.bcx', async () => {
			//aranged in before each
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].max_bcx = 1;
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].bcx = 1;

			const findCardInfoSpy = jest
				.spyOn(cardsApi, 'findCardInfo')
				.mockClear()
				.mockImplementation((id) => {
					return Promise.resolve([
						{
							player: 'x',
							uid: id,
							card_detail_id: 168,
							xp: 5,
							gold: false,
							edition: 4,
							market_id: '95d7db6abf70ccb4004f825c8eb4dd214dd71feb-3',
							buy_price: '2.844',
							alpha_xp: 0,
							details: { id: 168, rarity: 1, editions: '4', tier: null },
						},
					] as any);
				});

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-bcx5'], currency: 'USD', price: 2, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(findCardInfoSpy).toHaveBeenCalledWith(['C4-168-bcx5']);
			expect(res).toStrictEqual({});
		});

		it('should return {} if listing cp/usd > min_cp_per_usd', async () => {
			//aranged in before each
			local_settings.bids[0].min_cp_per_usd = 1000;

			const findCardInfoSpy = jest
				.spyOn(cardsApi, 'findCardInfo')
				.mockClear()
				.mockImplementation((id) => {
					return Promise.resolve([
						{
							player: 'x',
							uid: id,
							card_detail_id: 168,
							xp: 5,
							gold: false,
							edition: 4,
							market_id: '95d7db6abf70ccb4004f825c8eb4dd214dd71feb-3',
							buy_price: '2.844',
							alpha_xp: 0,
							details: { id: `168`, rarity: 1, editions: '4', tier: null },
						},
					] as any);
				});

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-bcx5'], currency: 'USD', price: 1.5, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(findCardInfoSpy).toHaveBeenCalledWith(['C4-168-bcx5']);
			expect(res).toStrictEqual({});
		});

		it('should return {} if listing price is not bellow burn value', async () => {
			//aranged in before each
			local_settings.bids[0].bellow_burn_value = true;

			const findCardInfoSpy = jest
				.spyOn(cardsApi, 'findCardInfo')
				.mockClear()
				.mockImplementation((id) => {
					return Promise.resolve([
						{
							player: 'x',
							uid: id,
							card_detail_id: 171,
							xp: 5,
							gold: false,
							edition: 4,
							market_id: '95d7db6abf70ccb4004f825c8eb4dd214dd71feb-3',
							buy_price: '0.5',
							alpha_xp: 0,
							details: { id: 171, rarity: 1, editions: '4', tier: null },
						},
					] as any);
				});

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-171-bcx5'], currency: 'USD', price: 0.5, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(findCardInfoSpy).toHaveBeenCalledWith(['C4-171-bcx5']);
			expect(res).toStrictEqual({});
		});

		it('should reset bcx for multiple bids', async () => {
			//aranged in before each
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].max_bcx = 1;
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].bcx = 1;
			local_settings.bids.push({
				id: 1,
				comment: 'bid 2',
				cards: { 168: { max_bcx_price: 0.5, max_quantity: 1, quantity: 1, max_bcx: 0, bcx: 0 } },
				prices: { 168: { buy_price: 0, low_price: 0.8 } },
			});

			const findCardInfoSpy = jest.spyOn(cardsApi, 'findCardInfo').mockClear();

			//Act
			const res = await _trade.check_desired(
				{ cards: ['C4-168-bcx5'], currency: 'USD', price: 0.4, fee_pct: 500.0 },
				'123456'
			);

			//Assert
			expect(findCardInfoSpy).toHaveBeenCalledTimes(0); // because price is lower that 1 bcx price
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[1].cards[168].bcx).toBe(0);
			expect(res).not.toBe(null);
			expect(res.seller_tx_id).toBe('123456');
			expect(res.card_id).toBe('C4-168-bcx5');
		});
	});

	describe('check_prices', () => {
		const getPrices = market.getPrices as jest.Mock;
		const getBids = market.getBids as jest.Mock;

		beforeEach(() => {
			jest.clearAllMocks();
			getPrices.mockImplementation(() => [
				{
					card_detail_id: 447,
					gold: false,
					edition: 7,
					low_price_bcx: 3,
					low_price: 4,
				},
				{
					card_detail_id: 447,
					gold: true,
					edition: 7,
					low_price_bcx: 20,
					low_price: 25,
				},
			]);
			getBids.mockImplementation(() => {
				return {
					bids: [
						{
							card_detail_id: 447,
							edition: 7,
							gold: false,
							usd_price: 2,
						},
						{
							card_detail_id: 447,
							edition: 7,
							gold: true,
							usd_price: 24,
						},
					],
				};
			});
		});

		it('should generate prices based on provided bids', async () => {
			//AAA arange act assert
			local_settings.bids.push({
				id: 10,
				comment: 'Grum Flameblade',
				cards: { 447: { max_bcx_price: 5, max_quantity: 5, max_bcx: 0, bcx: 0, quantity: 5 } },
				auto_set_buy_price: true,
				buy_pct_below_market: 10,
				gold_only: false,
			});
			local_settings.bids.push({
				id: 20,
				comment: 'Grum Flameblade',
				cards: { 447: { max_bcx_price: 50, max_quantity: 1, max_bcx: 0, bcx: 0, quantity: 1 } },
				auto_set_buy_price: true,
				buy_pct_below_market: 10,
				gold_only: true,
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			await trade.get_marketData_and_update_bid_prices();

			//Assert
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[0].prices[447].buy_price).toBe(2.2); // bid * 1.1
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[1].prices[447].buy_price).toBe(22.5); // low_price * 0.9
		});

		it('should set buy_price to max_bcx_price when max_bcx_price is provided', async () => {
			//AAA arange act assert
			local_settings.bids.push({
				id: 10,
				comment: 'Grum Flameblade',
				cards: { 447: { max_bcx_price: 3.55, max_quantity: 5, max_bcx: 5, bcx: 5, quantity: 5 } },
				gold_only: false,
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			await trade.get_marketData_and_update_bid_prices();

			//Assert
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[0].prices[447].buy_price).toBe(3.55);
		});

		it("should return null if we couldn't get marketPrices", async () => {
			//AAA arange act assert
			getPrices.mockImplementation(() => []);

			local_settings.bids.push({
				id: 10,
				comment: 'Grum Flameblade',
				cards: { 447: { max_bcx_price: 5, max_quantity: 5, max_bcx: 0, bcx: 0, quantity: 5 } },
				auto_set_buy_price: true,
				buy_pct_below_market: 10,
				gold_only: false,
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			const prices = await trade.get_marketData_and_update_bid_prices();

			//Assert
			expect(prices).toBe(null);
		});

		it('should generate 0 prices if auto_set_buy_price = false and max_bcx_price is not set', async () => {
			//AAA arange act assert
			local_settings.bids.push({
				id: 10,
				comment: 'Grum Flameblade',
				cards: { 447: { max_quantity: 5, max_bcx: 5, bcx: 5, quantity: 5 } },
				bellow_burn_value: true,
				gold_only: false,
			});
			const trade = new Trade(local_settings, card_details, {} as MongoClient);

			//Act
			await trade.get_marketData_and_update_bid_prices();

			//Assert
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[0].prices[447].buy_price).toBe(0);
		});
	});

	describe('process, prepare_to_buy', () => {
		let _trade: any;
		const buy_cards_spy = jest.spyOn(hive, 'buy_cards').mockImplementation((acc: string, data: any) => {
			return Promise.resolve({ id: data.items[0] + '_buy_cards' } as TransactionConfirmation);
		});

		const getTransaction = market.getTransaction as jest.Mock;
		getTransaction.mockImplementation((id) => {
			return {
				trx_info: {
					id: id,
					type: 'market_purchase',
					player: 'peakmonsters0',
					data: '{"items":["69d863f36f54ffa0e43bfb1375f627226fe860e9-1"],"price":0.3594177984824369,"all_or_none":false,"currency":"DEC","app":"cardauctionz","market":"monstermarket"}',
					success: true,
					error: null,
					block_num: 70269896,
					created_date: '2022-12-05T21:47:18.000Z',
					result: '{"success":true,"purchaser":"peakmonsters0","num_cards":1,"total_usd":0.45,"total_dec":400,"total_fees_dec":20,"by_seller":[{"seller":"mrfantastic616","items":["123"],"total_usd":0.45,"total_dec":400,"total_fees":20}]}',
				},
			};
		});

		beforeEach(async () => {
			const getUsableBalanceMock = user.getUsableBalance as jest.Mock;
			getUsableBalanceMock.mockImplementation((username: string, options: any) => 100000);

			local_settings.bids.push({
				id: 10,
				comment: 'Trade Chaos cards',
				editions: ['untamed'],
				rarities: ['common'],
				elements: ['water'],
				types: ['monster'],
				max_bcx_price: 5,
				sell_for_pct_more: 10,
				buy_pct_below_market: 20,
				auto_set_buy_price: true,
				max_quantity: 5,
				prices: {
					168: { buy_price: 0.5, low_price: 0.7 },
					169: { buy_price: 0.4, low_price: 0.6 },
					170: { buy_price: 0.3, low_price: 0.5 },
					171: { buy_price: 0.2, low_price: 0.4 },
				},
				cards: {
					168: { max_bcx_price: 5, max_quantity: 5, quantity: 5, bcx: 0, max_bcx: 0 },
					169: { max_bcx_price: 5, max_quantity: 5, quantity: 5, bcx: 0, max_bcx: 0 },
					170: { max_bcx_price: 5, max_quantity: 5, quantity: 5, bcx: 0, max_bcx: 0 },
					171: { max_bcx_price: 5, max_quantity: 5, quantity: 5, bcx: 0, max_bcx: 0 },
				},
			});
			_trade = new Trade(local_settings, card_details, {} as MongoClient);
			await _trade.get_current_balance(_trade.accounts[0]);
		});

		it('should return undefined if opration is not custom_json', async () => {
			//Arange
			const opperation = { op: ['test'] };

			//Act
			const resp = await _trade.process(opperation);

			//Assert
			expect(resp).toBeUndefined();
			expect(buy_cards_spy).not.toHaveBeenCalled();
		});

		it('should call buy_cards if everything passed', async () => {
			//Arange
			let getBlockNumSpy = jest.spyOn(hive, 'getBlockNum').mockImplementation(async () => {
				await sleep(100);
				return 1;
			});
			const cards_to_buy: CardToBuy[] = [
				{
					seller_tx_id: '123',
					bid_idx: 0,
					card_id: 'C4-168-FA5C2EF9TC',
					card_name: 'test',
					card_detail_id: 168,
					bcx: 0,
					card_cp: 0,
					price: 0.45,
					fee_pct: 500,
					buy_price: {
						buy_price: 0.5,
					},
				},
			];

			//Act
			await _trade.prepare_to_buy(_trade.accounts[0], cards_to_buy, Date.now() - 9000, 1);

			//Assert
			expect(buy_cards_spy).toHaveBeenCalledTimes(5);
			expect(getBlockNumSpy).toHaveBeenCalled();
		});

		it('should return undefined if cards_to_buy is empty array', async () => {
			//Arange
			buy_cards_spy.mockClear();

			//Act
			const res = await _trade.prepare_to_buy(
				_trade.accounts[0],
				[null, null, undefined, ''],
				new Date(Date.now() - 14400000 - 7000).toLocaleString()
			);

			//Assert
			expect(buy_cards_spy).not.toHaveBeenCalled();
			expect(res).toBeUndefined();
		});

		it('should return undefined if buy_cards throws exception', async () => {
			//Arange
			buy_cards_spy.mockClear();
			const buy_cards_spy_local = jest.spyOn(hive, 'buy_cards').mockRejectedValue('mock error');
			const cards_to_buy: CardToBuy[] = [
				{
					seller_tx_id: '123',
					bid_idx: 0,
					card_id: 'C4-168-FA5C2EF9TC',
					card_name: 'test',
					card_detail_id: 168,
					bcx: 0,
					card_cp: 0,
					price: 0.45,
					fee_pct: 500,
					buy_price: {
						buy_price: 0.5,
					},
				},
			];

			//Act
			await _trade.prepare_to_buy(_trade.accounts[0], cards_to_buy, Date.now() - 10000, 1);

			//Assert
			expect(buy_cards_spy_local).toHaveBeenCalled();
		});

		it('should not call buy_cards if card price > user balance', async () => {
			//aranged in before each
			buy_cards_spy.mockClear();
			const getUsableBalanceMock = user.getUsableBalance as jest.Mock;
			getUsableBalanceMock.mockImplementation((username: string, options: any) => 400);
			await _trade.get_current_balance(_trade.accounts[0]);

			const cards_to_buy: CardToBuy[] = [
				{
					seller_tx_id: '123',
					bid_idx: 0,
					card_id: 'C4-168-FA5C2EF9TC',
					card_name: 'test',
					card_detail_id: 168,
					bcx: 0,
					card_cp: 0,
					price: 0.5,
					fee_pct: 500,
					buy_price: {
						buy_price: 0.45,
					},
				},
			];

			//Act
			await _trade.prepare_to_buy(
				_trade.accounts[0],
				cards_to_buy,
				new Date(Date.now() - 14400000 - 7000).toLocaleString()
			);

			//Assert
			expect(buy_cards_spy).not.toHaveBeenCalled();
		});

		it('should reset bcx and quantity after failed buying transaction', async () => {
			//Arange
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].quantity = 0;
			// @ts-ignore Object is possibly 'undefined'
			local_settings.bids[0].cards[168].bcx = 0;

			const getTransaction = market.getTransaction as jest.Mock;
			getTransaction.mockImplementation((id) => {
				return {
					trx_info: {
						id: id,
						success: false,
						error: 'failed tranaction',
					},
				};
			});
			const cards_to_buy: CardToBuy[] = [
				{
					seller_tx_id: '123',
					bid_idx: 0,
					card_id: 'C4-168-FA5C2EF9TC',
					card_name: 'test',
					card_detail_id: 168,
					bcx: 0,
					card_cp: 0,
					price: 0.45,
					fee_pct: 500,
					buy_price: {
						buy_price: 0.5,
					},
				},
			];
			_trade.buying_account_number[cards_to_buy[0].card_id] = 1;

			//Act
			await _trade.check_buying_result(_trade.accounts[0], { data: cards_to_buy, tx_ids: ['123456'] });

			//Assert
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[168].quantity).toBe(1);
			// @ts-ignore Object is possibly 'undefined'
			expect(local_settings.bids[0].cards[168].bcx).toBe(0);
		});
	});

	describe('start', () => {
		let _trade: any;

		beforeEach(async () => {
			jest.clearAllMocks();
			_trade = new Trade(local_settings, card_details, {} as MongoClient);
		});

		it('should reset sl_api_calls_per_minute if 1 minute has passed', async () => {
			//Arrange
			jest.spyOn(_trade, 'run_job');
			jest.spyOn(_trade, 'process');
			_trade.sl_api_calls_per_minute = 100;
			_trade.minute_timer = Date.now() - 61 * 1000;

			//Act
			await _trade.start();

			//Assert
			expect(_trade.sl_api_calls_per_minute).toEqual(0);
			expect(_trade.minute_timer).toBeGreaterThanOrEqual(Date.now() - 5 * 1000);
		});

		it('should not reset sl_api_calls_per_minute if 1 minute has not passed', async () => {
			//Arrange
			jest.spyOn(_trade, 'run_job');
			jest.spyOn(_trade, 'process');
			_trade.sl_api_calls_per_minute = 100;
			const time = Date.now() - 50 * 1000;
			_trade.minute_timer = time;

			//Act
			await _trade.start();

			//Assert
			expect(_trade.sl_api_calls_per_minute).toEqual(100);
			expect(_trade.minute_timer).toEqual(time);
		});
	});
});
