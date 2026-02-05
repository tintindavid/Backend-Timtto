import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://Tinvaz:38jPEulx5UgDmOAV@biolab-sas.mxgmg.mongodb.net/Timtto?retryWrites=true&w=majority'
//process.env.MONGO_URI; // usa la MISMA URI que Railway

const client = new MongoClient(uri);

async function checkMongo() {
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');

    // 👇 CAMBIA SOLO ESTO
    const dbName = 'Timtto';          // mismo nombre que ves en Atlas
    const collectionName = 'tenant';    // colección exacta

    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    const count = await collection.countDocuments();

    console.log(`📦 Documentos en ${collectionName}:`, count);

    const sample = await collection.findOne();
    console.log('📄 Documento ejemplo:', sample);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

checkMongo();
