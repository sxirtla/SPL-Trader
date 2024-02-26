import { MongoClient } from 'mongodb';
import { TransactionConfirmation } from '@hiveio/dhive';
jest.mock('./../api/market');

import * as hive from '../api/hive';
jest.mock('./../api/hive');

import * as tradesRepo from '../dal/tradesRepo';
jest.mock('./../dal/tradesRepo');

let sell = require('./../api/sell');

describe('Sell', () => {
	let defaultAccount = 'THIEF_BESTBOOM';

	describe('cards', () => {
		let sell_cards_spy: any;
		let findTradeByCardIdSpy: any;

		beforeEach(async () => {
			jest.clearAllMocks();
			jest.isolateModules(() => {
				//need to reset CARDS variable
				sell = require('./../api/sell');
			});

			sell_cards_spy = jest.spyOn(hive, 'sell_cards').mockImplementation((acc: string, data: any) => {
				return Promise.resolve({ id: data[0].cards[0] + '_sell_cards' } as TransactionConfirmation);
			});
			findTradeByCardIdSpy = jest
				.spyOn(tradesRepo, 'findTradeByCardId')
				.mockReturnValue(
					Promise.resolve({ uid: 'C7-123-abcd', sell: { market_price: {} } } as tradesRepo.Trade)
				);
		});

		it('should call sell_cards on hive if we have cards to sell', async () => {
			//Arrange
			sell.add_CARDS(defaultAccount, [
					{
						cards: ['C7-123-abcd'],
						currency: 'USD',
						price: 0.5,
						fee_pct: 600,
						list_fee: 1,
						list_fee_token: 'DEC',
					},
					{
						cards: ['C7-123-dcba'],
						currency: 'USD',
						price: 5.5,
						fee_pct: 600,
						list_fee: 1,
						list_fee_token: 'DEC',
					},
				]
			);
			//Act
			await sell.sell_cards({} as MongoClient, {});

			//Assert
			expect(sell_cards_spy).toHaveBeenCalledTimes(1);
			expect(findTradeByCardIdSpy).toHaveBeenCalledTimes(2);
			expect(Object.values(sell.get_CARDS()).flat().length).toBe(0);
		});

		it('should not call hive.sell_cards if no cards are for sale', async () => {
			//Arrange
			sell.add_CARDS('acc1', []);

			//Act
			await sell.sell_cards({} as MongoClient, {});

			//Assert
			expect(sell_cards_spy).not.toHaveBeenCalled();
			expect(findTradeByCardIdSpy).not.toHaveBeenCalled();
			expect(Object.values(sell.get_CARDS()).flat().length).toBe(0);
		});
	});
});
