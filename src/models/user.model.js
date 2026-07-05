'use strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    fullName: { type: String, trim: true },
    username: { type: String, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'technician', 'user', 'superadmin'], default: 'technician' },
    phone: { type: String, trim: true },
    city: { type: String, trim: true },
    registroInvima: { type: String, trim: true },
    photo: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    fileFirma: { type: String, trim: true },
    // Set to true when the user must rotate their password on next login.
    // Activated by E1 onboarding (temp passwords) and E2 SuperAdmin reset.
    mustChangePassword: { type: Boolean, default: false },
    // Self-service password recovery token (SHA-256 hash of rawToken). Cleared on use.
    passwordResetToken:   { type: String, default: null },
    passwordResetExpires: { type: Date,   default: null },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Indexes
// Compound unique index per tenant
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, username: 1 });
userSchema.index({ tenantId: 1, isDeleted: 1 });
userSchema.index({ tenantId: 1, createdAt: -1 });

// Virtual/fullName
userSchema.pre('save', function (next) {
  if (!this.fullName && (this.firstName || this.lastName)) {
    this.fullName = `${this.firstName || ''}${this.firstName && this.lastName ? ' ' : ''}${this.lastName || ''}`.trim();
  }
  next();
});

// Hash password if modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

// Exclude sensitive fields from responses
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpires;
    return ret;
  },
});

// Default query to exclude soft-deleted (opt-out with { includeDeleted: true })
userSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

export const User = model('User', userSchema);
