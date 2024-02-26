import fs from 'fs';
import { GameSettings } from '../types/trade';
import * as http from '../utility/http';

const urlSettings = 'https://api2.splinterlands.com/settings';
const settings_file = './data/gameSettings.json';
let settings: GameSettings | null = null;
let last_downloaded = 0;
let in_progress = false;

const getGameSettingsFromApi = async (force: boolean = false): Promise<GameSettings | null> => {
	if (!force && in_progress) return null;
	try {
		in_progress = true;
		settings = await http
			.get(urlSettings)
			.then((x) => x && x.json())
			.then((x: GameSettings) => {
				if (x.error) throw new Error(x.error);
				return x;
			});
		last_downloaded = Date.now();
		in_progress = false;
		return settings;
	} catch (e: Error | any) {
		console.log('Error while getting global settings:', e.message);
		return settings;
	}
};

const downloadGameSettings = async (force: boolean = false): Promise<void> => {
	let newSettings = null;
	if (force || !settings || Date.now() - last_downloaded > 5 * 60 * 1000)
		newSettings = await getGameSettingsFromApi(force);

	if (newSettings) fs.writeFileSync(settings_file, JSON.stringify(newSettings, null, '\t'));
};

const readSettings = () => {
	if (settings && Date.now() - last_downloaded < 5 * 60 * 1000) return settings;

	if (!fs.existsSync(settings_file)) {
		downloadGameSettings(true);
		return settings || ({} as GameSettings);
	}

	downloadGameSettings();

	let rawdata = fs.readFileSync(settings_file, { encoding: 'utf8' });
	return JSON.parse(rawdata) as GameSettings;
};

export { downloadGameSettings, readSettings };
