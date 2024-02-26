import * as fs from 'fs';

import { downloadCardDetails, readCardDetails } from './api/cards';
import { connectToMongo, disconnect } from './dal/repo'
import * as hive from './api/hive';
import Trade from './api/trade';
import { LocalSettings } from './types/trade';

(async () => {
	await downloadCardDetails();
	const card_details = readCardDetails();
	let config: LocalSettings = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
	
	let serverClient = await connectToMongo(config.global_params.mongo_url);
	hive.init(config.global_params.preferred_hive_node);
	let trader = new Trade(
		config,
		card_details,
		serverClient
	);
	trader.setup();
	await trader.run_job(config.global_params.fetch_market_price_delay);
	let stream = hive.getStream();
	stream
		.on('data', (operation) => {
			trader.start(operation);
		})
		.on('end', async () => {
			stream.pause();
			await disconnect(serverClient);
			console.log('END');
		});
})();