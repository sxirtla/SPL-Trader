import { SignedTransaction } from '@hiveio/dhive';
import * as http from './../utility/http';

const getPlayerBalances = (user: string) =>
	http
		.get('https://api2.splinterlands.com/players/balances?username=' + user)
		.then((x) => x && x.json())
		.catch((e: Error | any) => {
			console.log('Player balances were not found:', e.message);
			return {};
		});

const getUsableBalance = async (user: string, options: { currency: string; minimum_balance: number }) => {
	let balances = await getPlayerBalances(user);
	let full_balance = balances.find((b: { token: string }) => b.token == options.currency.toUpperCase()).balance;
	return Math.max(full_balance - options.minimum_balance, 0);
};

const transferFee = (tx: SignedTransaction) => {
	return http
		.post('https://broadcast.splinterlands.com/send', {
			signed_tx: JSON.stringify(tx),
		})
		.then((res) => res && res.json())
		.catch((e) => {
			return { success: false, message: e.message };
		});
};

export { getPlayerBalances, getUsableBalance, transferFee };
