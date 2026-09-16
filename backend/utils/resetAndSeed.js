const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const Category = require('../models/Category');
const Department = require('../models/Department');
const Asset = require('../models/Asset');
const AccessRequest = require('../models/AccessRequest');
const Notification = require('../models/Notification');
const { DEPARTMENTS } = require('../constants');

async function resetAndSeed() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('[RESET] Connected to MongoDB. Clearing collections...');

        // Clear standard models
        await Promise.all([
            User.deleteMany({}),
            Category.deleteMany({}),
            Department.deleteMany({}),
            Asset.deleteMany({}),
            AccessRequest.deleteMany({}),
            Notification.deleteMany({})
        ]);

        // Bypass WORM restriction on AuditLogs by dropping the collection directly
        try {
            await mongoose.connection.collection('auditlogs').drop();
            console.log('[RESET] Audit logs WORM ledger reset.');
        } catch {
            console.log('[RESET] Audit logs collection already empty or missing.');
        }

        console.log('[RESET] Database wiped successfully.');

        // 1. Create Master Admin
        const adminHash = await bcrypt.hash('Admin@123', 12);
        const admin = await User.create({
            name: 'System Admin',
            email: 'admin@wehear.in',
            password: adminHash,
            role: 'Admin',
            department: 'Electronics',
            title: 'Chief Security Officer',
            mustChangePassword: false,
        });
        console.log('[SEED] Created Admin: admin@wehear.in / Admin@123');

        // 2. Create Department Heads for each department
        const heads = [
            { name: 'Electronics Head', email: 'electronics@wehear.in', dept: 'Electronics' },
            { name: 'Product Design Head', email: 'productdesign@wehear.in', dept: 'Product design' },
            { name: 'HR Head', email: 'hr@wehear.in', dept: 'Hr' },
            { name: 'Accounts Head', email: 'accounts@wehear.in', dept: 'Accounts' },
            { name: 'UI/UX Head', email: 'uiux@wehear.in', dept: 'UI/UX' },
            { name: 'Web Apps Head', email: 'web@wehear.in', dept: 'Web Applications' },
            { name: 'Mobile Apps Head', email: 'mobile@wehear.in', dept: 'Mobile Applications' },
        ];

        for (const h of heads) {
            const hash = await bcrypt.hash('Head@123', 12);
            await User.create({
                name: h.name,
                email: h.email,
                password: hash,
                role: 'Management',
                department: h.dept,
                title: `Head of ${h.dept}`,
                headOfDepartments: [h.dept],
                mustChangePassword: false,
            });
            console.log(`[SEED] Created Dept Head for ${h.dept}: ${h.email} / Head@123`);
        }

        // 3. Create sample Team Members
        const memberHash = await bcrypt.hash('Member@123', 12);
        await User.create({
            name: 'UI/UX Developer',
            email: 'member.uiux@wehear.in',
            password: memberHash,
            role: 'Engineering',
            department: 'UI/UX',
            title: 'Frontend Engineer',
            mustChangePassword: false,
        });
        console.log('[SEED] Created Team Member: member.uiux@wehear.in / Member@123');

        // 4. Create 1-to-1 Repositories (Categories) for each Department
        for (const dName of DEPARTMENTS) {
            // Create the Repository (Category) so it shows in the sidebar
            const cat = await Category.create({
                name: dName, // Repository named exactly after the Department (e.g., "Electronics")
                allowedRoles: ['Admin', 'Management', 'Engineering'], // Allows it to appear in the sidebar for everyone
                downloadRoles: ['Admin'],
                createdBy: admin._id,
            });

            // Create the Department mapping inside that Repository
            await Department.create({
                name: dName,
                category: cat._id,
                allowedRoles: ['Admin', 'Management', 'Engineering'], // Allows users to select it during upload
                downloadRoles: ['Admin'],
                createdBy: admin._id,
            });
        }
        console.log('[SEED] 7 Repositories successfully created and mapped to 7 Departments.');

        console.log('[RESET & SEED COMPLETE] You are ready to test!');
        process.exit(0);
    } catch (err) {
        console.error('[RESET ERROR]', err);
        process.exit(1);
    }
}

resetAndSeed();