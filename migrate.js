const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'nourish_super_secret_key_2026';

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.log('❌ MongoDB connection error:', err));

const EmployeeSchema = new mongoose.Schema({ _id: String }, { strict: false, timestamps: true });
const LeaveSchema = new mongoose.Schema({ _id: String }, { strict: false, timestamps: true });
const UserSchema = new mongoose.Schema({ _id: String }, { strict: false, timestamps: true });

const Employee = mongoose.model('Employee', EmployeeSchema);
const Leave = mongoose.model('Leave', LeaveSchema);
const User = mongoose.model('User', UserSchema);

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'partials/layout');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Auth Middlewares
const ensureAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    res.locals.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('token');
    res.redirect('/login');
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).send("Access Denied");
    }
    next();
  };
};

// Login & Users
app.get('/login', (req, res) => res.render('login', { error: null, layout: false }));
app.post('/login', async (req, res) => {
  const { employeeId, password } = req.body;
  const user = await User.findOne({ employeeId });
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: "Invalid ID or Password", layout: false });
  }
  const token = jwt.sign({ _id: user._id, employeeId: user.employeeId, name: user.name, role: user.role, farmCC: user.farmCC }, JWT_SECRET, { expiresIn: '1d' });
  res.cookie('token', token, { httpOnly: true });
  res.redirect('/');
});
app.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login'); });

// Dashboard
app.get('/', ensureAuth, (req, res) => res.render('index', { currentPath: '/', pageTitle: 'Dashboard' }));

// Search & Update
app.get('/search', ensureAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  let query = { $or: [{ employeeId: new RegExp(q, 'i') }, { employeeName: new RegExp(q, 'i') }] };
  if (req.user.role === 'Farm Incharge' || req.user.role === 'Farm Store Incharge') {
    query.farmCC = { $in: [req.user.farmCC, Number(req.user.farmCC), String(req.user.farmCC)] };
  }
  const results = await Employee.find(query);
  res.render('search', { query: q, results, currentPath: '/search', pageTitle: 'Search Results' });
});

app.post('/update/:id', ensureAuth, async (req, res) => {
  const id = req.params.id;
  const emp = await Employee.findOne({ _id: id });
  if (!emp) return res.redirect('/');

  const { employeeName, employeeId, currentStatus, workingDays, carryForwardEL } = req.body;
  let updateData = { employeeName, currentStatus };
  if (employeeId !== undefined) updateData.employeeId = employeeId;
  if (workingDays !== undefined) updateData.workingDays = Number(workingDays);

  await Employee.updateOne({ _id: id }, { $set: updateData });
  res.redirect('/search?q=' + encodeURIComponent(employeeName));
});

// Active List
app.get('/active', ensureAuth, async (req, res) => {
  const selectedFarm = req.query.farm || '';
  let query = { currentStatus: 'Active' };
  if (req.user.role === 'Farm Incharge' || req.user.role === 'Farm Store Incharge') {
    query.farmCC = { $in: [req.user.farmCC, Number(req.user.farmCC), String(req.user.farmCC)] };
  } else if (selectedFarm) {
    query.farmName = selectedFarm;
  }
  const list = await Employee.find(query);
  const farms = await Employee.distinct('farmName');
  res.render('active', { list, farms, selectedFarm, currentPath: '/active', pageTitle: 'Active Employees' });
});

// Baki routes (Inactive, Absent, Leave etc.) ager motoi thakbe...
// (Ami puro code ta dibo, message limit er karone choto korchi, tumi ei ta copy koro)

app.listen(PORT, () => { console.log(`✅ Server running: http://localhost:${PORT}`); });