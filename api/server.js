const express = require("express");
const app = express();
const mysql = require("mysql2");

const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "root",
    database: "40461638",
    port: 3306,
    multipleStatements: true
});

db.getConnection((err) => {
    if (err) {
        console.error("MySQL connection failed:", err);
        throw err;
    }
    console.log("Connected to the database");
});

app.use(express.urlencoded({ extended: true }));

// Get pathway from sID
const getPathway = (sId) => {
    const parts = sId.split("-");
    const code = parts[1];
    switch (code) {
        case "IFSY": 
            return "Information Systems";
        case "BSAS": 
            return "Business Data Analytics";
        default: 
            return "Unknown Pathway";
    }
};

// Module lists for each pathway/level
const ifsyL1Modules = [6, 12, 2, 3, 1, 65, 13, 4, 5, 30];
const ifsyL2Modules = [9, 11, 98, 66, 67, 8, 100, 102, 101, 99, 7, 10, 29, 106, 43];
const bsasL1Modules = [14, 15, 20, 57, 18, 1, 19];
const bsasL2Modules = [87, 38, 17, 66, 67, 11, 39, 21, 22, 16];

// Determine current level from modules
const getCurrentLevel = (modules, pathway) => {
    const moduleIds = modules.map(m => m.moduleId);
    const l1Modules = pathway === "Information Systems" ? ifsyL1Modules : bsasL1Modules;
    const l2Modules = pathway === "Information Systems" ? ifsyL2Modules : bsasL2Modules;

    const hasL1 = moduleIds.some(id => l1Modules.includes(id));
    const hasL2 = moduleIds.some(id => l2Modules.includes(id));

    if (hasL2) return "L2";
    if (hasL1) return "L1";
    return "Unknown";
};

// Authenticating user
app.post("/authenticate", (req, res) => {
    const sId = req.body.sId;
    const password = req.body.password;

    const checkUser = `SELECT sId, isAdmin FROM students WHERE sId = ? AND password = ?`;

    db.query(checkUser, [sId, password], (err, row) => {
        if (err) {
            console.error("Database error:", err);
            throw err;
        }

        if (row.length > 0) {
            const isAdmin = row[0].isAdmin === 1;
            res.json({ "userID": row[0].sId, "authenticate": true, "isAdmin": isAdmin });
        } else {
            res.json({ "authenticate": false });
        }
    });
});

// Student info endpoint
app.get("/student/:sId", (req, res) => {
    const sId = req.params.sId;
    const getStudent = `SELECT 
                            s.sId, 
                            s.firstName, 
                            s.lastName, 
                            s.email,
                            s.secondaryEmail,
                            s.profilePic, 
                            smgd.entryLevel
                        FROM students s
                        LEFT JOIN student_module_grade_data smgd 
                            ON s.sId = smgd.sId
                        WHERE s.sId = ?
                        ORDER BY smgd.acad_Yr DESC
                        LIMIT 1`;

    db.query(getStudent, [sId], (err, row) => {
        if (err) {
            console.error("Database error:", err);
            throw err;
        }

        if (row.length > 0) {
            const pathway = getPathway(sId);
            res.json({
                sId: row[0].sId,
                firstName: row[0].firstName,
                lastName: row[0].lastName,
                email: row[0].email,
                secondaryEmail: row[0].secondaryEmail || "None", //Default if no secondary email.
                profilePic: row[0].profilePic || null,
                pathway: pathway,
                entryLevel: row[0].entryLevel || "Unknown" //Default if no entry level data.
            });
        } else {
            res.json({ "error": "Student not found" });
        }
    });
});

//Post for updating student details
app.post("/student/:sId/update", (req, res) => {
    const sId = req.params.sId;
    const secondaryEmail = req.body.secondaryEmail;
    const profilePic = req.body.profilePic;

    const updateStudent = `UPDATE students SET secondaryEmail = ?, profilePic = ? WHERE sId = ?`;

    db.query(updateStudent, [secondaryEmail, profilePic, sId], (err, result) => {
        if (err) {
            console.error("Database error:", err);
            throw err;
        }else{
            res.json({ "success": "Secondary email added" });
        }

        
    });
});

// Student progression endpoint
app.get("/student/:sId/progress", (req, res) => {
    const sId = req.params.sId;
    const getProgress = `
        SELECT 
            smgd.acad_Yr, smgd.moduleId, smgd.firstGrade, smgd.gradeResult, 
            smgd.resitGrade, smgd.resitResult, smgd.semModule AS semester, smgd.entryLevel,
            m.moduleTitle, m.creditCount AS credits
        FROM student_module_grade_data smgd
        JOIN modules m ON smgd.moduleId = m.moduleId
        WHERE smgd.sId = ?
        ORDER BY smgd.acad_Yr DESC, smgd.semModule`;

    db.query(getProgress, [sId], (err, rows) => {
        if (err) {
            console.error("Database error:", err);
            throw err;
        }

        if (rows.length === 0) {
            return res.json({ "error": "No progression data found" });
        }

        const pathway = getPathway(sId);
        const latestYear = rows[0].acad_Yr;
        const latestYearModules = rows.filter(row => row.acad_Yr === latestYear);
        const currentLevel = getCurrentLevel(latestYearModules, pathway);
        const entryLevel = rows[0].entryLevel;

        //Split modules into L1 and L2 (display all modules in L1 if from different pathway)
        const level1Modules = rows.filter(row => {
            const l2Modules = pathway === "Information Systems" ? ifsyL2Modules : bsasL2Modules;
            return !l2Modules.includes(row.moduleId); // Include everything that is NOT an L2 module
        });
            
        const level2Modules = rows.filter(row => {
            const l2Modules = pathway === "Information Systems" ? ifsyL2Modules : bsasL2Modules;
            return l2Modules.includes(row.moduleId);
        });

        // Get current level modules for progress decision/summary
        const levelModules = currentLevel === "L1" ? level1Modules : level2Modules;
               
        // Calculate grades and credits
        let creditsEarned = 0;
        let totalCreditsAttempted = 0;
        let grades = [];
        let modulesPassed = 0;
        let modulesFailed = 0;
        
        levelModules.forEach(row => {
            const finalResult = row.resitResult || row.gradeResult;
            const rawGrade = row.resitGrade !== '' ? parseInt(row.resitGrade) || 0 : parseInt(row.firstGrade) || 0;
            const finalGrade = finalResult === 'pass capped' ? 40 : (finalResult === 'absent' ? 0 : rawGrade);

            totalCreditsAttempted += row.credits;

            if (finalResult === 'pass' || finalResult === 'pass capped') {
                creditsEarned += row.credits;
                modulesPassed++;
            } else if (finalResult === 'fail' || finalResult === 'absent') {
                modulesFailed++;
            }

            grades.push(finalGrade);
        });

        const avgGrade = levelModules.length > 0 ? grades.reduce((sum, g) => sum + g, 0) / levelModules.length : 0;
        const totalCreditsRequired = 120;

        // Core modules check (using latest year modules)
        let coreModules = [];
        let coreRequirementMet = true;

        if (currentLevel === 'L1') {
            coreModules = [];
            coreRequirementMet = true;
        } else if (currentLevel === 'L2' && pathway === 'Information Systems') {
            coreModules = [9, 100]; // IFSY259, IFSY240
            coreRequirementMet = latestYearModules.some(row => 
                coreModules.includes(row.moduleId) && (row.resitResult || row.gradeResult) === 'pass');
        } else if (currentLevel === 'L2' && pathway === 'Business Data Analytics') {
            coreModules = [22]; // IFSY257
            coreRequirementMet = latestYearModules.some(row => 
                row.moduleId === 22 && (row.resitResult || row.gradeResult) === 'pass');
        }

        // Progression decision
        let decision = '';
        const hasResits = levelModules.some(row => row.resitResult === 'fail' || row.resitResult === 'excused' || row.resitResult === 'absent');
        
        if (creditsEarned >= 100 && avgGrade >= 40 && coreRequirementMet) {
            decision = currentLevel === 'L1' 
                ? `Progress to Year 2${hasResits ? ' (Resit Offered)' : ''}`
                : `Progress to Final Year${hasResits ? ' (Resit Offered)' : ''}`;
        } else if (creditsEarned < 100 || !coreRequirementMet) {
            decision = 'Resit Required';
        } else {
            decision = 'Contact Advisor of Studies';
        }

        //Send all data to the client
        res.json({
            level1Modules, // L1 modules for grades
            level2Modules, // L2 modules for grades
            latestYearModules, // Latest year for other uses
            levelModules,      // Current level for decision/summary
            creditsEarned,
            totalCredits: totalCreditsAttempted,
            totalCreditsRequired,
            avgGrade,
            modulesPassed,
            modulesFailed,
            decision,
            pathway,
            currentLevel,
            acadYr: latestYear,
            entryLevel
        });
    });
});

//Admin dashboard endpoint
app.get("/admin/:sId/dashboard", (req, res) => {
    const sId = req.params.sId;

    //verify admin
    const getAdmin = `SELECT sId, firstName, lastName, email, secondaryEmail, profilePic, isAdmin 
                        FROM students 
                        WHERE sId = ? AND isAdmin = 1`;
    
    db.query(getAdmin, [sId], (err, row) => {
        if (err) {
            console.error("Database error", err);
            throw err;
        }
        if (row.length === 0) {
            return res.json({ "error": "Not an admin" });
        }

        //return admin data
        res.json({
            sId: row[0].sId,
            firstName: row[0].firstName,
            lastName: row[0].lastName,
            email: row[0].email,
            secondaryEmail: row[0].secondaryEmail || "None",
            profilePic: row[0].profilePic || null,
        });
    });    
});

//Admin student data endpoint
app.get("/admin/:sId/students", (req,res) => {

    const sId = req.params.sId;
    const page = req.query.page || 1; // Default to page 1 if not provided
    const limit = 20; // Number of students per page
    const offset = (page - 1) * limit; // Calculate the offset for pagination

    //verify admin
    const checkAdmin = 'SELECT IsAdmin FROM students WHERE sId = ?';
    db.query(checkAdmin, [sId], (err, row) => {
        if (err) {
            console.error("Database error", err);
            throw err;
        }
        if (row.length === 0 || row[0].IsAdmin !== 1) {
            return res.json({ "error": "Not an admin" });
        }

        //Get total number of students for pagination
        const getTotalStudents = 'SELECT COUNT(*) AS total FROM students WHERE isAdmin = 0';
        db.query(getTotalStudents, (err, result) => {
            if (err) {
                console.error("Database error", err);
                throw err;
            }
            const totalStudents = result[0].total;
            const totalPages = Math.ceil(totalStudents / limit);

            //Get all students with pagination
            const getStudents = `SELECT 
                                    s.sId, 
                                    s.firstName, 
                                    s.lastName, 
                                    s.email,
                                    MAX(smgd.entryLevel) AS entryLevel
                                FROM students s
                                LEFT JOIN student_module_grade_data smgd 
                                    ON s.sId = smgd.sId
                                WHERE s.isAdmin = 0
                                GROUP BY s.sId, s.firstName, s.lastName, s.email
                                ORDER BY s.sId
                                LIMIT ? OFFSET ?`;

            db.query(getStudents, [limit, offset], (err, rows) => {
                if (err) {
                    console.error("Database error", err);
                    throw err;
                }
                res.json({
                    adminId: sId,
                    students: rows.map(row => ({
                        sId: row.sId,
                        firstName: row.firstName,
                        lastName: row.lastName,
                        email: row.email,
                        pathway: getPathway(row.sId),
                        entryLevel: row.entryLevel || "Not Enrolled"
                
                    })),
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: totalPages,
                        totalStudents: totalStudents
                    }
                });
            });                   
        });
    });
});

app.listen(4000, () => {
    console.log("API running on port 4000");
});