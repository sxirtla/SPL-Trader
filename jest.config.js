module.exports = {
	preset: 'ts-jest',
	transform: {
		'^.+\\.(ts|tsx)?$': 'ts-jest'
	},
	testMatch: [
        "**/?(*.)+(spec|test).[t]s?(x)"
    ]
};
