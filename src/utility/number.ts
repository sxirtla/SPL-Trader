declare global {
	interface Number {
		toFixed3(): number;
	}
}

Number.prototype.toFixed3 = function () {
	return Math.trunc(Number(this) * 1000) / 1000;
};

export {};
