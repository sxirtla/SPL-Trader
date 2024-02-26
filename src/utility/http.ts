const _importDynamic = new Function('modulePath', 'return import(modulePath)');

export const fetch = async function (...args: any) {
    const {default: fetch} = await _importDynamic('node-fetch');
    return fetch(...args);
}

const handleResponse = (res: any) => {
	const contentType = res.headers.get('content-type');
	if (res.status === 200 && contentType && contentType.indexOf('application/json') !== -1) return res;

	let errorMessage = `ERROR CODE: ${res.status}, ContentType: ${contentType}`;
	console.log('Fetch failed with:', errorMessage);
	throw new Error(errorMessage);
};

const get = async (url: string) => {
	const controller = new AbortController();
	const signal = controller.signal;
	setTimeout(() => {
		controller.abort();
	}, 20000);

	const options = { signal };

	//console.log(`fetching: ${url}`);
	return await fetch(url, options)
		.then(handleResponse)
		.catch(async (e: Error | any) => {
			console.log(`fetch failed, retrying: ${url}`);
			return await fetch(url);
		});
};

const post = async (url: string, data: any) => {
	const controller = new AbortController();
	const signal = controller.signal;
	setTimeout(() => {
		controller.abort();
	}, 20000);

	const options = {
		method: 'POST',
		body: JSON.stringify(data),
		headers: { 'Content-Type': 'application/json' },
		signal,
	};

	return await fetch(url, options)
		.then(handleResponse)
		.catch(async (e: Error | any) => {
			return await fetch(url, options);
		});
};

export { get, post };
