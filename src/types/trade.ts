export type MarketPrice = {
	low_price?: number;
	low_price_bcx?: number;
	pm_bid?: number;
	buy_price: number;
};

export type BidCard = {
	max_quantity?: number;
	quantity?: number;
	max_bcx?: number;
	bcx?: number;
	max_bcx_price?: number;
};

export type Bid = {
	id: number;
	comment: string;
	cards?: {
		[x: number]: BidCard;
	};
	editions?: Array<string>;
	rarities?: Array<string>;
	elements?: Array<string>;
	types?: Array<string>;
	max_bcx?: number;
	max_bcx_price?: number;
	min_cp_per_usd?: number;
	gold_only?: boolean;
	only_modern?: boolean;
	sell_for_pct_more?: number;
	buy_pct_below_market?: number;
	auto_set_buy_price?: boolean;
	bellow_burn_value?: boolean;
	prices?: {
		[x: number]: MarketPrice;
	};
	max_quantity?: number;
};

export type GameSettings = {
	error?: string;
	season: { id: number; name: string; ends: Date };
	dec_price: number;
	combine_rates_gold: number[][];
	combine_rates: number[][];
	xp_levels: number[][];
	loot_chests: any;
	dec: {
		untamed_burn_rate: number[];
		burn_rate: number[];
		alpha_burn_bonus: number;
		promo_burn_bonus: number;
		max_burn_bonus: number;
		gold_burn_bonus: number;
		gold_burn_bonus_2: number;
	};
	version: string;
	chain_props: { ref_block_num: number; ref_block_prefix: number; time: string };
};

export type GlobalParams = {
	mongo_url: string;
	accounts: {
		[account: string]: {
			currency: string;
			minimum_balance: number;
			rc_from?: string;
			rc_amount_b?: number;
			active_key: string;
			posting_key: string;
		};
	};
	min_profit_usd: number;
	profit_fee_pct: number;
	fetch_market_price_delay: number;
	preferred_hive_node?: string;
	min_dec_price?: number;
};

export type LocalSettings = {
	bids: Bid[];
	global_params: GlobalParams;
};

export type SellCards = { cards: string[]; currency?: string; price: string; fee_pct?: number };

export type CardToBuy = {
	seller_tx_id: string;
	bid_idx: number;
	card_id: string;
	card_detail_id: number;
	card_name: string;
	bcx: number;
	card_cp: number;
	price: number;
	fee_pct: number;
	marketPrices: {
		low_price?: number;
		low_price_bcx?: number;
		pm_bid?: number;
		buy_price: number;
	};
};

export type BuyTxInfo = {
	id: string;
	success: string;
	error: string;
	result: string;
	block_num: number;
	created_date: string;
};

export type BuyTxResult = {
	total_dec: number;
	num_cards: number;
	total_usd: number;
	total_fees_dec: number;
	total_market_fees_dec: number;
	total_burn_fees_dec: number;
	purchaser: string;
	by_seller: { seller: string; items: string | any[] }[];
};
