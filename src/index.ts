import { downloadCardDetails, readCardDetails } from './api/cards';
import { downloadGameSettings } from './api/settings';
import { connectToMongo, disconnect } from './dal/repo';
import { loadAndValidateConfig } from './utility/helper';
import * as hive from './api/hive';
import Trade from './api/trade';

(async () => {
	await downloadCardDetails();
	await downloadGameSettings();

	const cardDetails = readCardDetails();
	const config = await loadAndValidateConfig();

	const serverClient = await connectToMongo(config.global_params.mongo_url);
	hive.init(config.global_params.preferred_hive_node);
	const trader = new Trade(config, cardDetails, serverClient);
	await trader.run_job(config.global_params.fetch_market_price_delay);
	const stream = hive.getStream();
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
