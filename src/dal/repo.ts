import { MongoClient } from 'mongodb';

const connectToMongo = async (uri: string) => {
	try {
		const client = new MongoClient(uri);
		await client.connect();
		return client;
	} catch (e: Error | any) {
		throw new Error(`Couldn't conntect to mongo server, ${e.message}`);
	}
};

const disconnect = async (client: MongoClient) => {
	try {
		await client.close();
		console.log('closed mongo connection');
	} catch (e) {
		console.log('connection already closed');
	}
};

const find = async (client: MongoClient, collection: string, filter: any, sort = {}, skip = 0, limit = 0) => {
	const col = await getCol(client, collection);
	return await col
		.find(filter)
		.sort(sort)
		.skip(skip)
		.limit(limit)
		.toArray()
		.then(async (items) => {
			return items;
		});
};

const fetchAll = async (client: MongoClient, collection: string) => {
	const col = await getCol(client, collection);
	return await col
		.find({})
		.toArray()
		.then(async (items) => {
			return items;
		});
};

const updateOne = async (client: MongoClient, collection: string, filter: any, data: any) => {
	const col = await getCol(client, collection);

	return await col.updateOne(filter, { $set: data }, { upsert: true });
};

const insertOne = async (client: MongoClient, collection: string, data: any) => {
	const col = await getCol(client, collection);

	return await col.insertOne(data);
};

const deleteOne = async (client: MongoClient, collection: string, filter: any) => {
	const col = await getCol(client, collection);

	return await col.deleteOne(filter);
};

const deleteMany = async (client: MongoClient, collection: string, filter: any) => {
	const col = await getCol(client, collection);

	return await col.deleteMany(filter);
};

const getCol = async (client: MongoClient, collection: string) => {
	return client.db('SLB').collection(collection);
};

export { connectToMongo, disconnect, fetchAll, updateOne, insertOne, deleteOne, deleteMany, find };
