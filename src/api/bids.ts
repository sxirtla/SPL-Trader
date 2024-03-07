import { Bid, BidCard, GlobalParams } from '../types/trade';
import { colorToSplinter } from '../utility/helper';
import { MarketData } from './market';

const BID_TEMPLATE: Bid = {
	id: 0,
	comment: '',
	cards: {},
	editions: [],
	rarities: [],
	elements: [],
	types: [],
	min_cp_per_usd: 0,
	gold_only: false,
	only_modern: false,
	sell_for_pct_more: 0,
	buy_pct_below_market: 0,
	auto_set_buy_price: false,
	bellow_burn_value: false,
};

const rarities = {
	1: 'common',
	2: 'rare',
	3: 'epic',
	4: 'legendary',
};

const editions = {
	0: 'alpha',
	1: 'beta',
	2: 'promo',
	3: 'reward',
	4: 'untamed',
	5: 'dice',
	//6: 'gladiatos'
	7: 'chaos',
	8: 'rift',
	//10: 'chaos-soulbound'
	12: 'rebel',
};

const validBid = (bid: Bid) => {
	let cards_to_buy = Object.values(bid.cards as keyof Bid);

	if (
		(!bid.max_bcx_price ? cards_to_buy.some((c: any) => !c.max_bcx_price) : false) &&
		!bid.min_cp_per_usd &&
		!bid.auto_set_buy_price &&
		!bid.bellow_burn_value
	) {
		console.log(
			`either max_bcx_price or min_cp_per_usd or auto_set_buy_price or bellow_burn_value should be set. Removing bid [${bid.id}]!`
		);
		return false;
	}

	if (!bid.max_quantity ? cards_to_buy.some((c: any) => !c.max_quantity) : false) {
		console.log(`max_quantity must be provided. Removing Bid [${bid.id}]!`);
		return false;
	}

	return true;
};

const generateBidCards = (bid: Bid, card_details: any) => {
	let bid_editions = bid.editions as string[];

	let cards_tmp = card_details.filter(
		(card: any) =>
			(bid.rarities as string[]).includes(rarities[card.rarity as keyof typeof rarities]) &&
			(bid.elements as string[]).includes(colorToSplinter(card.color)) &&
			(bid.types as string[]).includes(card.type.toLowerCase()) &&
			(bid_editions.includes(editions[parseInt(card.editions.split(',')[0]) as keyof typeof editions]) ||
				bid_editions.includes(editions[parseInt(card.editions.split(',')[1]) as keyof typeof editions]))
	);

	if (bid.only_modern) {
		cards_tmp = cards_tmp.filter((card: any) => parseInt(card.id) >= 299);
	}

	cards_tmp.forEach(
        (tmp: any) =>
            ((bid.cards as {[x: number]: BidCard})[tmp.id] = {
                max_quantity: bid.max_quantity,
                quantity: bid.max_quantity,
                max_bcx: bid.max_bcx,
                bcx: bid.max_bcx,
                max_bcx_price: bid.max_bcx_price,
            })
    );
};

const setupBids = (bids: Bid[], card_details: any) => {
	let looking_for_cards: string[] = [];
	bids = bids.sort((a, b) => a.id - b.id);

	for (let i = 0; i < bids.length; i++) {
		const template = JSON.parse(JSON.stringify(BID_TEMPLATE));
		let bid = Object.assign(template, bids[i]);
		if (!validBid(bid as Bid)) {
			bids.splice(i, 1);
			continue;
		}

		generateBidCards(bid, card_details);

		Object.values(bid.cards).forEach((c: any) => {
			if (c.max_bcx > c.max_quantity) c.max_quantity = c.max_bcx;
			c.quantity = c.max_quantity;
			c.max_bcx = c.max_bcx || 0;
			c.bcx = c.max_bcx;
			c.max_bcx_price = c.max_bcx_price || 0;
		});

		looking_for_cards = looking_for_cards || [];
		looking_for_cards.push(...Object.keys(bid.cards));
		bids[i] = bid;
	}

	return looking_for_cards;
};

const generateBidPrices = (bid: Bid, pm_bids: any, marketPrices: MarketData[], options: GlobalParams) => {
	if (!bid.auto_set_buy_price) {
		for (const cId in bid.cards) {
			let cardId = Number(cId);
			let card = marketPrices.find((c) => c.card_detail_id == cardId && c.gold == bid.gold_only);

			let pm_bid = pm_bids.bids.find(
				(b: { card_detail_id: number; gold: boolean }) =>
					b.card_detail_id == cardId && b.gold == bid.gold_only
			);
			if (!bid.prices) bid.prices = [];
			bid.prices[cardId] = {
				buy_price: bid.cards[cardId].max_bcx_price || 0,
				low_price: card?.low_price,
				low_price_bcx: card?.low_price_bcx,
				pm_bid: pm_bid.usd_price,
			};
		}
		return;
	}

	const bellow_market = bid.buy_pct_below_market as number;

	for (const card of marketPrices) {
		if (!bid.cards || !bid.cards[card.card_detail_id] || card.gold !== bid.gold_only) {
			continue;
		}

		const pm_bid: number =
			pm_bids.bids.find(
				(b: { card_detail_id: number; gold: boolean }) =>
					b.card_detail_id == card.card_detail_id && b.gold == bid.gold_only
			)?.usd_price || 0;
		//if difference between low price and pm bid is > 20, this card is not desired by many and will be hard to sell
		//also this is needed to protect form sudden spike in price
		//for example if someone buys 100 cards and price spikes from 1$ to 10$ but the bids will stay the same
		//better way would be to see the average sell price for 24h but there is no easy way to do it
		const price_bid_diff = Math.min(1 - pm_bid / card.low_price, 0.2);
		let buy_price = Math.min(
			pm_bid * (price_bid_diff + 1),//limit buy price of undesired cards by 20% above the peakmonsters bids
			card.low_price * (1 - bellow_market / 100),
			bid.cards[card.card_detail_id].max_bcx_price || Number.MAX_VALUE
		);

		let min_profit = options.min_profit_usd || 0.01;
		let potential_sell_price = Math.max(card.low_price * 0.98, card.low_price - 0.1);
		let potential_profit = potential_sell_price * 0.94 - buy_price * 0.97;
		if (potential_profit < min_profit){
			buy_price -= min_profit - potential_profit;
		}

		if (buy_price < 0.01) {
			delete bid.cards[card.card_detail_id];
			continue;
		}

		bid.prices = bid.prices || [];
		bid.prices[card.card_detail_id] = {
			low_price: card.low_price,
			low_price_bcx: card.low_price_bcx,
			pm_bid: pm_bid,
			buy_price: buy_price
		};
	}
}

export { setupBids, generateBidPrices };
