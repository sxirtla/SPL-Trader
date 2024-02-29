import * as fs from 'fs';
import { validator } from "json-validator-utill";
import { LocalSettings } from "../types/trade";

const colorToDeck: any = {
	red: 'Fire',
	blue: 'Water',
	white: 'Life',
	black: 'Death',
	green: 'Earth',
	gold: 'Dragon',
	gray: 'Neutral',
};

const generatePassword = (length: number) => {
	let rng = Math.random;
	var charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
		retVal = '';
	for (var i = 0, n = charset.length; i < length; ++i) {
		retVal += charset.charAt(Math.floor(rng() * n));
	}
	return retVal;
};

const sleep = (ms: number) => {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};

const colorToSplinter = (color: string) => {
	return colorToDeck[color.toLowerCase()].toLowerCase() || undefined;
};

const loadAndValidateConfig = async () => {
	let config: LocalSettings = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
	let config_schema = JSON.parse(fs.readFileSync('./config.schema.json', 'utf-8'));

	const response = validator.validate(config, config_schema);
	if (!response.isValid) {
		console.error(response.errors);
		throw new Error('Invalid config file');
	}

	return config;
};

export { generatePassword, sleep, colorToSplinter, loadAndValidateConfig };
