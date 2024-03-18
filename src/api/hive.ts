import * as dhive from '@hiveio/dhive';

import { generatePassword } from './../utility/helper';
import { readSettings, downloadGameSettings } from './settings';
import { GlobalParams, GameSettings } from '../types/trade';

type HiveCustomJson = {
	required_auths: string[];
	required_posting_auths: string[];
	id: string;
	json: string;
};

let client: dhive.Client;
let ACCOUNTS = {} as { [acc: string]: { key: dhive.PrivateKey; active_key: dhive.PrivateKey } };
let gameSettings = {} as GameSettings;

const init = (node: string = 'https://api.hive.blog') => {
	if (!client)
		client = new dhive.Client([
			node,
			'https://hive-api.3speak.tv',
			'https://api.deathwing.me',
			'https://hived.emre.sh',
			'https://api.openhive.network',
			'https://anyx.io',
			'https://api.hivekings.com',
		]);
};

const generateKey = (params: GlobalParams) => {
	Object.keys(params.accounts).forEach((acc) => {
		ACCOUNTS[acc] = {
			key: dhive.PrivateKey.from(params.accounts[acc].posting_key),
			active_key: dhive.PrivateKey.from(params.accounts[acc].active_key),
		};
	});
	gameSettings = readSettings();
};

const prepareTx = async (tx: HiveCustomJson) => {
	await downloadGameSettings(true);
	let settings = readSettings();

	return <dhive.Transaction>{
		ref_block_num: settings.chain_props.ref_block_num & 65535,
		ref_block_prefix: settings.chain_props.ref_block_prefix,
		expiration: new Date(new Date(settings.chain_props.time + 'Z').getTime() + 600 * 1000).toISOString(),
		extensions: [],
		operations: [['custom_json', tx]],
	};
};

const sign = async (tx: HiveCustomJson) => {
	try {
		let acc = tx.required_auths[0] || tx.required_posting_auths[0];
		let currentKey = tx.required_auths.length > 0 ? ACCOUNTS[acc].active_key : ACCOUNTS[acc].key;
		let prepedTx = await prepareTx(tx);
		prepedTx.expiration = prepedTx.expiration.split('.')[0];
		return dhive.cryptoUtils.signTransaction(prepedTx, [currentKey]);
	} catch (e) {
		console.log('Error in sign:', e);
		return {} as dhive.SignedTransaction;
	}
};

const findTransaction = (txId: string) => client.transaction.findTransaction(txId);

const broadcast = (tx: HiveCustomJson): Promise<dhive.TransactionConfirmation | null> => {
	let acc = tx.required_auths[0] || tx.required_posting_auths[0];
	if (!ACCOUNTS[acc]) return Promise.reject(null);
	let currentKey = tx.required_auths.length > 0 ? ACCOUNTS[acc].active_key : ACCOUNTS[acc].key;
	return client.broadcast.json(tx, currentKey).catch((e) => {
		console.log('Broadcast error: ', e?.message);
		return null;
	});
};

const getStream = (): NodeJS.ReadableStream => client.blockchain.getOperationsStream(); //{ options: { mode: dhive.BlockchainMode.Latest } }

const getBlockNum = () => client.blockchain.getCurrentBlockNum(dhive.BlockchainMode.Latest); //dhive.BlockchainMode.Latest

const getBlockNumbers = (to: undefined | number = undefined) => client.blockchain.getBlockNumbers({ to: to });

const getRCMana = async (acc: string) => {
	let rc = await client.rc.getRCMana(acc);
	return rc.current_mana / 1000000000;
};

const delegateRC = (from: string, to: string, max_rc: number) => {
	let tx: HiveCustomJson = {
		required_auths: [],
		required_posting_auths: [from],
		id: 'rc',
		json: JSON.stringify(['delegate_rc', { from: from, delegatees: [to], max_rc: max_rc }]),
	};

	return client.broadcast.json(tx, ACCOUNTS[to].key).catch((e) => {
		console.log('Broadcast error: ', e?.message);
		return null;
	});
};

const sell_cards = (acc: string, data: any) => {
	let jsondata = {
		required_auths: [acc],
		required_posting_auths: [],
		id: 'sm_sell_cards',
		json: JSON.stringify(data),
	};

	return broadcast(jsondata).catch((e: Error) => {
		console.log('Error in sell_cards broadcast:', e);
		return null;
	});
};

const buy_cards = (acc: string, data: any) => {
	data = {
		...data,
		all_or_none: false,
		market: 'monstercardstore',
		app: 'monstercardstore',
		n: generatePassword(10),
	};

	let jsondata = {
		required_auths: [acc],
		required_posting_auths: [],
		id: 'sm_market_purchase',
		json: JSON.stringify(data),
	};

	return broadcast(jsondata).catch((e: Error) => {
		console.log('Error in buy_cards broadcast:', e.message);
		return null;
	});
};

const transfer_fee = (acc: string, profit_fee: number) => {
	let jsondata: HiveCustomJson = {
		required_auths: [acc],
		required_posting_auths: [],
		id: 'sm_token_transfer',
		json: JSON.stringify({
			token: 'DEC',
			to: 'altryx',
			qty: Math.ceil((profit_fee / gameSettings.dec_price) * 100) / 100,
			memo: 'altryx',
			app: `splinterlands/${gameSettings.version}`,
			n: generatePassword(10),
		}),
	};

	return sign(jsondata);
};

const update_card_price = (acc: string, data: any) => {
	let jsondata = {
		required_auths: [acc],
		required_posting_auths: [],
		id: 'sm_update_price',
		json: JSON.stringify(data),
	};

	return broadcast(jsondata);
};

export {
	init,
	generateKey,
	sign,
	findTransaction,
	broadcast,
	getBlockNum,
	getBlockNumbers,
	getStream,
	getRCMana,
	delegateRC,
	sell_cards,
	buy_cards,
	transfer_fee,
	update_card_price,
};
