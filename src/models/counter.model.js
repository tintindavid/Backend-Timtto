import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CounterSchema = new Schema({
  tenantId: { type: String, required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, {
  timestamps: true,
  collection: 'counters'
});

CounterSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const Counter = model('Counter', CounterSchema);
