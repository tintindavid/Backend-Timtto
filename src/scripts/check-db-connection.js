#!/usr/bin/env node
import mongoose from 'mongoose';

async function main() {
  try {
    const argv = process.argv.slice(2);
    const uri = process.env.MONGO_URI || argv[0];
    const tenantId = argv[1] || 'biolmec';
    if (!uri) {
      console.error('Usage: set MONGO_URI env or pass URI as first arg');
      process.exit(2);
    }

    console.log('Connecting to', uri.split('@').pop());
    await mongoose.connect(uri, { dbName: undefined, autoIndex: false });
    console.log('Connected to MongoDB');

    // import model after connect to avoid model overwrite issues
    const mod = await import('../models/tenant.model.js');
    const Tenant = mod.Tenant;

    const t = await Tenant.findOne({ tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') } }).lean();
    if (!t) {
      console.log(`Tenant with tenantId='${tenantId}' not found`);
      process.exitCode = 1;
    } else {
      console.log('Tenant found:');
      console.log(JSON.stringify(t, null, 2));
    }
  } catch (err) {
    console.error('Error connecting/querying:', err && err.message ? err.message : err);
    process.exitCode = 3;
  } finally {
    try { await mongoose.disconnect(); } catch(e){}
  }
}

main();
