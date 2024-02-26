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

export { generatePassword, sleep, colorToSplinter };
