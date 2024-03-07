import fs from 'fs';
import * as http from './../utility/http';
import { GameSettings } from '../types/trade';

let cardsDetails: any = undefined;
let last_checked = 0;
const cards_details_file = './data/cardsDetails.json';

type CARD_HISTORY = {
	card_id: string;
	transfer_date: string;
	transfer_type: string;
	transfer_tx: string;
	from_player: string;
	to_player: string;
	card_detail_id: number;
	xp: string;
	gold: boolean;
	edition: number;
	payment_amount: string;
	payment_currency: string;
	combined_cards: string;
};

export interface CardInfo {
	player: string;
	uid: string;
	card_detail_id: number;
	xp: number;
	gold: boolean;
	edition: number;
	card_set: string;
	collection_power: number;
	market_id: null;
	buy_price: null;
	market_listing_type: null;
	market_listing_status: null;
	market_created_date: null;
	rental_type: null;
	rental_days: null;
	rental_date: null;
	next_rental_payment: null;
	cancel_tx: null;
	cancel_date: null;
	cancel_player: null;
	last_used_block: null;
	last_used_player: null;
	last_used_date: null;
	last_transferred_block: number;
	last_transferred_date: string;
	alpha_xp: null;
	delegated_to: string;
	delegation_tx: string;
	skin: null;
	delegated_to_display_name: string;
	display_name: string;
	lock_days: null;
	unlock_date: null;
	wagon_uid: null;
	stake_start_date: null;
	stake_end_date: null;
	stake_plot: null;
	stake_region: null;
	created_date: string;
	created_block: number;
	created_tx: string;
	expiration_date: null;
	last_buy_price: string;
	last_buy_currency: string;
	bcx: number;
	land_base_pp: string;
	land_dec_stake_needed: number;
	details: Details;
	combined_card_id: string;
}

export interface Details {
	id: number;
	name: string;
	color: string;
	type: string;
	sub_type: null;
	rarity: number;
	drop_rate: number;
	is_starter: boolean;
	editions: string;
	created_block_num: null;
	last_update_tx: null;
	total_printed: number;
	is_promo: boolean;
	tier: number;
	secondary_color: null;
	stake_type_id: number;
	print_start_date: null;
}

const url_cards = 'https://api2.splinterlands.com/cards/get_details';
const url_card_lookup = 'https://api2.splinterlands.com/cards/find?ids=';
const url_card_history = 'https://api.splinterlands.com/cards/history?transfer_types=market&id=';

const downloadCardDetails = async (force: boolean = false) => {
	if (!force && lastModifiedMinsAgo() < 60) return;

	return http
		.get(url_cards)
		.then((x) => x && x.json())
		.then((x) => (x.error ? new Error(x.error) : x))
		.then(async (x) => {
			cardsDetails = x;
			if (!fs.existsSync('./data')) fs.mkdirSync('./data');
			fs.writeFileSync(cards_details_file, JSON.stringify(x, null, '\t'));
		})
		.catch((e) => {
			console.log('Error while getting all cards:', e.message);
		});
};

const lastModifiedMinsAgo = () => {
	if (!fs.existsSync(cards_details_file)) return Number.MAX_VALUE;

	let fileStat = fs.statSync(cards_details_file);

	return (new Date().getTime() - fileStat?.mtime.getTime()) / 60000;
};

const readCardDetails = () => {
	if (cardsDetails && Date.now() - last_checked < 60 * 60 * 1000) return cardsDetails;

	if (!fs.existsSync(cards_details_file)) {
		downloadCardDetails(true);
		return {};
	}
	downloadCardDetails();
	last_checked = Date.now();

	let rawdata = fs.readFileSync(cards_details_file, { encoding: 'utf8' });
	cardsDetails = JSON.parse(rawdata);

	return cardsDetails;
};

const findCardInfo = (card_ids: string[]): Promise<CardInfo[]> =>
	http
		.get(url_card_lookup + card_ids.join(','))
		.then((x) => x && x.json())
		.catch((e) => {
			console.log('Error while getting card details:', e.message);
			return [];
		});

const findCardSellPrice = (card_id: string, acc: string): Promise<number> =>
	http
		.get(url_card_history + card_id)
		.then((x) => x && x.json())
		.then((h: CARD_HISTORY[]) => h.find((x) => x.from_player === acc)?.payment_amount)
		.then((price) => (price ? Number(price) : 0))
		.catch((e) => {
			console.log('Error while getting card details:', e.message);
			return 0;
		});

const calc_bcx = (
	c: {
		card_detail_id: number;
		xp: number;
		alpha_xp?: number;
		details?: { tier: number | null; id: number; rarity: number };
		edition?: any;
		gold: boolean;
	},
	card_details: any[],
	game_settings: GameSettings
) => {
	try {
		const card = c?.xp > 1 ? { ...c, alpha_xp: 0 } : { ...c, alpha_xp: null };
		let details = card.details || card_details.find((x) => x.id == card.card_detail_id);
		if (card.edition == 4 || details?.tier >= 4) return card.xp;
		let xp = Math.max(card.xp - (card.alpha_xp || 0), 0);
		let xp_property =
			card.edition == 0 || (card.edition == 2 && details.id < 100)
				? card.gold
					? 'gold_xp'
					: 'alpha_xp'
				: card.gold
				? 'beta_gold_xp'
				: 'beta_xp';
		let rarity = details?.rarity;
		let bcx_xp = game_settings[xp_property as keyof GameSettings][rarity - 1];
		let bcx = Math.max(card.gold ? xp / bcx_xp : (xp + bcx_xp) / bcx_xp, 1);
		return bcx;
	} catch (e: Error | any) {
		throw new Error(`error in calc_bcx: ${e?.message}`);
	}
};

const getMaxXp = (
	details: { rarity: number; tier: number | null },
	edition: number,
	gold: boolean,
	game_settings: GameSettings
): number => {
	try {
		let rarity = details.rarity;
		let tier = details?.tier || 0;
		if (edition == 4 || tier >= 4) {
			let rates = gold ? game_settings.combine_rates_gold[rarity - 1] : game_settings.combine_rates[rarity - 1];
			return rates[rates.length - 1];
		} else return game_settings.xp_levels[rarity - 1][game_settings.xp_levels[rarity - 1].length - 1];
	} catch (e: Error | any) {
		throw new Error(`error in getMaxXp: ${e?.message}`);
	}
};

const calc_cp = (
	card: { card_detail_id: number; xp: number; edition?: number; details?: any; gold: boolean },
	bcx: number,
	card_details: any[],
	game_settings: GameSettings
): number => {
	try {
		const details = card.details || card_details.find((x) => x.id == card.card_detail_id);
		card.edition = card.edition || Number(details.editions.split(',')[0]);
		let alpha_dec = 0;
		let burn_rate =
			card.edition == 4 || details?.tier >= 4
				? game_settings.dec.untamed_burn_rate[details.rarity - 1]
				: game_settings.dec.burn_rate[details.rarity - 1];
		let dec = burn_rate * bcx;
		if (card.gold) {
			const gold_burn_bonus_prop = details?.tier >= 7 ? 'gold_burn_bonus_2' : 'gold_burn_bonus';
			dec *= game_settings.dec[gold_burn_bonus_prop];
		}
		if (card.edition == 0) dec *= game_settings.dec.alpha_burn_bonus;
		if (card.edition == 2) dec *= game_settings.dec.promo_burn_bonus;
		let total_dec = dec + alpha_dec;
		if (card.xp >= getMaxXp(details, card.edition, card.gold, game_settings))
			total_dec *= game_settings.dec.max_burn_bonus;
		if (details?.tier >= 7) total_dec = total_dec / 2;

		return total_dec;
	} catch (e: Error | any) {
		throw new Error(`error in calc_cp: ${e?.message}`);
	}
};

export { downloadCardDetails, readCardDetails, findCardInfo, findCardSellPrice, calc_bcx, calc_cp };
