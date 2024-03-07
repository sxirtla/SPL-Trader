import * as http from '../utility/http';

const urlPrices = 'https://api2.splinterlands.com/market/for_sale_grouped';
const urlBids = 'https://peakmonsters.com/api/bids/top';
const urlMarketHistory = 'https://api2.splinterlands.com/market/history?player=';
const urlTransactions = 'https://api2.splinterlands.com/transactions/lookup?trx_id=';
const urlCardPrices = 'https://api2.splinterlands.com/market/for_sale_by_card';

type MarketData = {
	card_detail_id: number;
	gold: boolean;
	edition: number;
	qty: number;
	low_price_bcx: number;
	low_price: number;
	high_price: number;
	level: number;
	mana: number;
};

export interface CardPrice {
	market_id: string;
	card_id: string;
	xp: number;
	alpha_xp: null;
	buy_price: number;
	seller: string;
	fee_percent: number;
	bcx: number;
	price_bcx: number;
	type: string;
	rental_type: null;
	expiration_date: string;
	last_used_block: number;
	last_used_date: string;
	last_transferred_block: number;
	last_transferred_date: string;
	last_used_player: string;
	gold: boolean;
	edition: number;
	card_detail_id: number;
	currency: string;
	level: number;
	uid: string;
}

const getPrices = (): Promise<Array<MarketData>> =>
	http
		.get(urlPrices)
		.then((x) => x && x.json())
		.catch((e) => {
			console.log('Error while getting market prices:', e.message);
			return [] as Array<MarketData>;
		});

const getCardPrices = (card_detail_id: number, gold: boolean): Promise<CardPrice[]> =>
	http
		.get(urlCardPrices + `?card_detail_id=${card_detail_id}&gold=${gold}`)
		.then((x) => x && x.json())
		.catch((e) => {
			console.log('Error while getting card prices:', e);
			return null;
		});

const getBids = () =>
	http
		.get(urlBids)
		.then((x) => x && x.json())
		.catch((e) => {
			console.log('Error while getting market bids:', e.message);
			return null;
		});

const getMarketHistory = (user: string) =>
	http
		.get(urlMarketHistory + user)
		.then((x) => x && x.json())
		.catch((e) => {
			console.log('Error while getting market history:', e.message);
		});

const getTransaction = (txId: string) =>
	http
		.get(urlTransactions + txId)
		.then((x) => x && x.json())
		.catch((e) => {
			console.log('Error while getting transactions:', e.message);
		});

export { getPrices, getCardPrices, getBids, getMarketHistory, getTransaction, MarketData };
