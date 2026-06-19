require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// ============================================================
// MONGODB CONNECTION
// ============================================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ============================================================
// MODELS
// ============================================================

// USER
const userSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  email:      { type: String, required: true, unique: true, lowercase: true },
  phone:      { type: String },
  password:   { type: String, required: true },
  country:    { type: String, default: 'NG' },
  state:      { type: String },
  city:       { type: String },
  verified:   { type: Boolean, default: false },
  disabled:   { type: Boolean, default: false },
  refCode:    { type: String, unique: true, sparse: true },
  referredBy: { type: String },
  wallet:     { type: Number, default: 0 },
  idImage:    { type: String },
  createdAt:  { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// ORDER
const orderSchema = new mongoose.Schema({
  tn:         { type: String, required: true, unique: true },
  name:       String,
  email:      String,
  phone:      String,
  service:    String,
  pstate:     String, pcity: String, paddr: String,
  dstate:     String, dcity: String, daddr: String,
  weight:     String,
  details:    String,
  insured:    { type: Boolean, default: false },
  insValue:   Number,
  insPremium: Number,
  walletPaid: { type: Boolean, default: false },
  status:     { type: String, default: 'Order Placed' },
  pod:        String,
  events:     [{ status: String, location: String, note: String, time: String, done: Boolean, cur: Boolean }],
  createdAt:  { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// TRUCK
const truckSchema = new mongoose.Schema({
  ownerEmail: String,
  ownerName:  String,
  type:       String,
  plate:      String,
  capacity:   String,
  state:      String,
  city:       String,
  phone:      String,
  price:      String,
  desc:       String,
  images:     [String],
  status:     { type: String, default: 'pending' },
  approved:   { type: Boolean, default: false },
  postedByAdmin: { type: Boolean, default: false },
  createdAt:  { type: Date, default: Date.now }
});
const Truck = mongoose.model('Truck', truckSchema);

// WALLET TOPUP
const topupSchema = new mongoose.Schema({
  ref:     String,
  email:   String,
  name:    String,
  amount:  Number,
  method:  String,
  status:  { type: String, default: 'pending' },
  receipt: String,
  createdAt: { type: Date, default: Date.now }
});
const Topup = mongoose.model('Topup', topupSchema);

// JOB
const jobSchema = new mongoose.Schema({
  title:    String,
  dept:     String,
  type:     String,
  location: String,
  desc:     String,
  active:   { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Job = mongoose.model('Job', jobSchema);

// COUPON
const couponSchema = new mongoose.Schema({
  code:      { type: String, unique: true },
  type:      String,
  value:     Number,
  maxUses:   Number,
  usedCount: { type: Number, default: 0 },
  desc:      String,
  expiry:    String,
  active:    { type: Boolean, default: true },
  assignedTo: String,
  createdAt: { type: Date, default: Date.now }
});
const Coupon = mongoose.model('Coupon', couponSchema);

// KB ENTRY
const kbSchema = new mongoose.Schema({
  q: String,
  a: String,
  createdAt: { type: Date, default: Date.now }
});
const KB = mongoose.model('KB', kbSchema);

// ACTIVITY LOG
const activitySchema = new mongoose.Schema({
  user:   String,
  action: String,
  page:   String,
  time:   String,
  createdAt: { type: Date, default: Date.now }
});
const Activity = mongoose.model('Activity', activitySchema);

// ============================================================
// HELPERS
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'jaad_secret_2026';
const ADMIN_PASS = process.env.ADMIN_PASS || 'jaad2026';

function rand(n) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function makeTrackNo(fromState, toState) {
  const STATE_CODES = {
    'Lagos':'LG','FCT - Abuja':'FC','Kano':'KN','Rivers':'RV','Oyo':'OY',
    'Kaduna':'KD','Ogun':'OG','Ondo':'OD','Osun':'OS','Ekiti':'EK',
    'Enugu':'EN','Anambra':'AN','Imo':'IM','Abia':'AB','Edo':'ED',
    'Delta':'DT','Cross River':'CR','Akwa Ibom':'AK','Bayelsa':'BY',
    'Ebonyi':'EB','Adamawa':'AD','Gombe':'GM','Borno':'BO','Yobe':'YB',
    'Taraba':'TR','Bauchi':'BC','Plateau':'PL','Nasarawa':'NW','Benue':'BN',
    'Kogi':'KG','Kwara':'KW','Niger':'NG','Kebbi':'KB','Sokoto':'SK',
    'Zamfara':'ZM','Katsina':'KT','Jigawa':'JG'
  };
  const f = STATE_CODES[fromState] || 'XX';
  const t = STATE_CODES[toState]   || 'XX';
  const d = new Date();
  const day = String(d.getDate()).padStart(2,'0');
  const mon = String(d.getMonth()+1).padStart(2,'0');
  return `JAAD/${f}/${t}/${day}/${mon}/${rand(4)}`;
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASS) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Email sender
async function sendEmail(to, subject, html) {
  if (!process.env.EMAIL_USER) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: `"Jaad Logistics" <${process.env.EMAIL_USER}>`,
      to, subject, html
    });
  } catch (e) { console.log('Email error:', e.message); }
}

function emailTemplate(name, message, trackingNo = '') {
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#080809;padding:24px;text-align:center">
      <h1 style="color:#DC1A22;font-size:28px;margin:0">JAAD</h1>
      <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">LOGISTICS</p>
    </div>
    <div style="padding:32px;background:#fff">
      <p>Dear <strong>${name}</strong>,</p>
      <p style="line-height:1.7">${message}</p>
      ${trackingNo ? `<div style="background:#f7f6f3;border-left:4px solid #DC1A22;padding:14px 18px;margin:20px 0;font-family:monospace;font-size:1.1rem;font-weight:bold">📦 ${trackingNo}</div>` : ''}
      <p style="color:#888;font-size:13px">Questions? WhatsApp us: +234 806 147 2153<br>Mon–Fri 8AM–8PM · Sat 9AM–5PM</p>
    </div>
    <div style="background:#080809;color:rgba(255,255,255,.4);text-align:center;padding:16px;font-size:12px">
      © 2026 Jaad Logistics · 64a Olushi Street, Lagos Island, Nigeria
    </div>
  </div>`;
}

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, country, state, city, idImage, referredBy } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const refCode = 'JAAD-' + rand(6);
    const user = await User.create({
      name, email, phone, password: hashed, country, state, city,
      idImage, refCode, referredBy: referredBy || null
    });
    await sendEmail(email, 'Welcome to Jaad Logistics!',
      emailTemplate(name, 'Your account has been created successfully. Complete your verification to start shipping.'));
    res.json({ success: true, message: 'Account created' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Account not found' });
    if (user.disabled) return res.status(403).json({ error: 'Account disabled. Contact info@jaadlogistics.com' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Incorrect password' });
    const token = jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { name: user.name, email: user.email, phone: user.phone, state: user.state, city: user.city, verified: user.verified, refCode: user.refCode, wallet: user.wallet } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ORDER ROUTES
// ============================================================
app.post('/api/orders', authMiddleware, async (req, res) => {
  try {
    const f = req.body;
    const tn = makeTrackNo(f.pstate, f.dstate);
    const order = await Order.create({
      tn, name: f.name, email: f.email, phone: f.phone,
      service: f.service, pstate: f.pstate, pcity: f.pcity, paddr: f.paddr,
      dstate: f.dstate, dcity: f.dcity, daddr: f.daddr,
      weight: f.weight, details: f.details,
      insured: f.insured, insValue: f.insValue, insPremium: f.insPremium,
      walletPaid: f.walletPaid,
      events: [{ status: 'Order Placed', location: `${f.pcity}, ${f.pstate}`, note: 'Order received and being processed.', time: new Date().toISOString(), done: true, cur: false }]
    });
    // Deduct wallet if wallet pay
    if (f.walletPaid && f.estPrice) {
      await User.findOneAndUpdate({ email: f.email }, { $inc: { wallet: -parseFloat(f.estPrice) } });
    }
    // Referral bonus on first order
    const user = await User.findOne({ email: f.email });
    if (user?.referredBy) {
      const orderCount = await Order.countDocuments({ email: f.email });
      if (orderCount === 1) {
        await User.findOneAndUpdate({ email: f.email }, { $inc: { wallet: 1000 } });
        await User.findOneAndUpdate({ refCode: user.referredBy }, { $inc: { wallet: 1000 } });
      }
    }
    await sendEmail(f.email, `Order Confirmed — ${tn}`,
      emailTemplate(f.name, `Your shipment from <b>${f.pcity}, ${f.pstate}</b> to <b>${f.dcity}, ${f.dstate}</b> has been confirmed and is being processed.`, tn));
    res.json({ success: true, tn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ email: req.user.email }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/track/:tn', async (req, res) => {
  try {
    const order = await Order.findOne({ tn: req.params.tn });
    if (!order) return res.status(404).json({ error: 'Shipment not found' });
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ADMIN ROUTES
// ============================================================
app.get('/api/admin/orders', adminMiddleware, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/orders/:tn/status', adminMiddleware, async (req, res) => {
  try {
    const { status, location, note } = req.body;
    const event = { status, location: location || 'Nigeria', note: note || 'Status updated.', time: new Date().toISOString(), done: ['Delivered','Picked Up'].includes(status), cur: ['In Transit','Out for Delivery'].includes(status) };
    const order = await Order.findOneAndUpdate(
      { tn: req.params.tn },
      { status, $push: { events: event } },
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await sendEmail(order.email, `Shipment Update — ${order.tn}`,
      emailTemplate(order.name, `Your shipment status has been updated to: <strong>${status}</strong><br>Location: ${location || 'Nigeria'}`, order.tn));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:email/toggle', adminMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.disabled = !user.disabled;
    await user.save();
    res.json({ success: true, disabled: user.disabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:email/verify', adminMiddleware, async (req, res) => {
  try {
    await User.findOneAndUpdate({ email: req.params.email }, { verified: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:email/wallet', adminMiddleware, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const user = await User.findOneAndUpdate(
      { email: req.params.email },
      { $inc: { wallet: parseFloat(amount) } },
      { new: true }
    );
    await sendEmail(req.params.email, 'Wallet Funded — Jaad Logistics',
      emailTemplate(user.name, `Your Jaad Logistics wallet has been credited with <strong>₦${Number(amount).toLocaleString()}</strong>.<br>Reason: ${reason || 'Admin credit'}<br>New balance: ₦${user.wallet.toLocaleString()}`));
    res.json({ success: true, wallet: user.wallet });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trucks
app.get('/api/admin/trucks', adminMiddleware, async (req, res) => {
  try { res.json(await Truck.find().sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/trucks/:id/approve', adminMiddleware, async (req, res) => {
  try {
    const truck = await Truck.findByIdAndUpdate(req.params.id, { status: 'active', approved: true }, { new: true });
    const user = await User.findOne({ email: truck.ownerEmail });
    if (user) await sendEmail(truck.ownerEmail, 'Truck Listing Approved — Jaad Logistics',
      emailTemplate(truck.ownerName, `Great news! Your truck listing (<strong>${truck.type} · ${truck.plate}</strong>) has been approved and is now live on the Jaad Logistics Truck Board.`));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/trucks/:id/reject', adminMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    const truck = await Truck.findByIdAndUpdate(req.params.id, { status: 'rejected', approved: false }, { new: true });
    await sendEmail(truck.ownerEmail, 'Truck Listing Update — Jaad Logistics',
      emailTemplate(truck.ownerName, `Your truck listing (<strong>${truck.type} · ${truck.plate}</strong>) could not be approved at this time.<br><br>Reason: ${reason || 'Does not meet requirements.'}<br><br>Please contact us for more information.`));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/trucks/:id', adminMiddleware, async (req, res) => {
  try { await Truck.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/trucks', adminMiddleware, async (req, res) => {
  try {
    const truck = await Truck.create({ ...req.body, status: 'active', approved: true, postedByAdmin: true });
    res.json({ success: true, truck });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Topups
app.get('/api/admin/topups', adminMiddleware, async (req, res) => {
  try { res.json(await Topup.find().sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/topups/:ref/credit', adminMiddleware, async (req, res) => {
  try {
    const topup = await Topup.findOneAndUpdate({ ref: req.params.ref }, { status: 'credited' }, { new: true });
    const user = await User.findOneAndUpdate({ email: topup.email }, { $inc: { wallet: topup.amount } }, { new: true });
    await sendEmail(topup.email, 'Wallet Funded — Jaad Logistics',
      emailTemplate(user.name, `Your wallet has been credited with <strong>₦${Number(topup.amount).toLocaleString()}</strong>.<br>New balance: ₦${user.wallet.toLocaleString()}`));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Jobs
app.get('/api/jobs', async (req, res) => {
  try { res.json(await Job.find({ active: true }).sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/jobs', adminMiddleware, async (req, res) => {
  try { res.json(await Job.create(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/jobs/:id', adminMiddleware, async (req, res) => {
  try { res.json(await Job.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/jobs/:id', adminMiddleware, async (req, res) => {
  try { await Job.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Coupons
app.get('/api/admin/coupons', adminMiddleware, async (req, res) => {
  try { res.json(await Coupon.find().sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/coupons', adminMiddleware, async (req, res) => {
  try { res.json(await Coupon.create(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/coupons/:id/toggle', adminMiddleware, async (req, res) => {
  try {
    const c = await Coupon.findById(req.params.id);
    c.active = !c.active; await c.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { code } = req.body;
    const c = await Coupon.findOne({ code: code.toUpperCase(), active: true });
    if (!c) return res.status(404).json({ error: 'Invalid or expired coupon' });
    if (c.maxUses && c.usedCount >= c.maxUses) return res.status(400).json({ error: 'Coupon usage limit reached' });
    if (c.expiry && new Date(c.expiry) < new Date()) return res.status(400).json({ error: 'Coupon expired' });
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// KB
app.get('/api/kb', async (req, res) => {
  try { res.json(await KB.find().sort({ createdAt: 1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/kb', adminMiddleware, async (req, res) => {
  try { res.json(await KB.create(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/kb/:id', adminMiddleware, async (req, res) => {
  try { await KB.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Trucks public
app.get('/api/trucks', async (req, res) => {
  try { res.json(await Truck.find({ status: 'active', approved: true }).sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trucks', authMiddleware, async (req, res) => {
  try {
    const truck = await Truck.create({ ...req.body, ownerEmail: req.user.email, ownerName: req.user.name, status: 'pending', approved: false });
    res.json({ success: true, truck });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Topup submit
app.post('/api/topups', authMiddleware, async (req, res) => {
  try {
    const { amount, method, receipt } = req.body;
    const ref = 'JAAD-' + Date.now();
    await Topup.create({ ref, email: req.user.email, name: req.user.name, amount, method, receipt, status: 'pending' });
    res.json({ success: true, ref });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Activity
app.post('/api/activity', authMiddleware, async (req, res) => {
  try {
    await Activity.create({ user: req.user.name, action: req.body.action, page: req.body.page, time: new Date().toISOString() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/activity', adminMiddleware, async (req, res) => {
  try { res.json(await Activity.find().sort({ createdAt: -1 }).limit(100)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Jaad Logistics API running on port ${PORT}`));
