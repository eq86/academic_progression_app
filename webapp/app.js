const express = require("express");
const app = express();
const path = require("path");
const session = require("express-session");
const axios = require("axios");

app.use(session({
    secret: "mysecretsessionkey",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 600000 },
}));

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "/public")));
app.use(express.urlencoded({ extended: true }));

// Login page
app.get("/", (req, res) => {
    res.render("login", { error: null });
});

// Authenticating user
app.post("/login", async (req, res) => {
    const { sId, password } = req.body;

    const ep = "http://localhost:4000/authenticate";
    const objData = { sId, password };
    const config = { headers: { "Content-Type": "application/x-www-form-urlencoded" } };

    try {
        const response = await axios.post(ep, objData, config);
        //console.log("API response:", response.data);

        if (response.data.authenticate === true) {
            req.session.student = response.data.userID;
            if (response.data.isAdmin) {
                res.redirect("/admindashboard");
            } else {
                res.redirect("/studentdashboard");
            }
            
        } else {
            res.render("login", { error: "Invalid credentials" });
        }
    }catch (err) {
        res.send("Error authenticating" + err);
    }
});

// Student dashboard
app.get("/studentdashboard", async (req, res) => {
    if (!req.session.student) {
        return res.redirect("/");
    }

    const userID = req.session.student;
    const ep = `http://localhost:4000/student/${userID}`;
    const config = { headers: { "Content-Type": "application/x-www-form-urlencoded" } };

    try {
        const response = await axios.get(ep, config);
        //console.log("Student data:", response.data);
        res.render("studentdash", { student: response.data });
    }catch (err) {
        res.send("Error fetching student data" + err);
    }
});

//student profile
app.get("/studentprofile", async (req, res) => {
    if (!req.session.student) {
        return res.redirect("/");
    }

    const userID = req.session.student;
    const ep = `http://localhost:4000/student/${userID}`;
    const config = { headers: { "Content-Type": "application/x-www-form-urlencoded" } };

    try{
        const response = await axios.get(ep, config);
        //console.log("Student data:", response.data);
        res.render("studentprofile", { student: response.data, success: null }); //success flag for email update.
    } catch (err) {
        res.send("Error fetching student data" + err);
    }
});

//update student profile
app.post("/studentprofile/update", async (req, res) => {
    if (!req.session.student) {
        return res.redirect("/");
    }

    const userID = req.session.student;
    const secondaryEmail = req.body.secondaryEmail;
    const profilePic = req.body.profilePic;
    const ep = `http://localhost:4000/student/${userID}/update`;
    const objData = { secondaryEmail, profilePic };
    const config = { headers: { "Content-Type": "application/x-www-form-urlencoded" } };

    try {
        const response = await axios.post(ep, objData, config);
        
        //updated student info - Used to diplay email updated message.
        const studentEp = `http://localhost:4000/student/${userID}`;
        const studentResponse = await axios.get(studentEp, config);
        res.render("studentprofile", { student: studentResponse.data, success: "Profile updated successfully!" });

    }catch (err) {
        res.send("Error updating secondary email" + err);
    }

});

//student progression
app.get("/studentprogression", async (req, res) => {
    
    if(!req.session.student) {
        return res.redirect("/");
    }

    const userID = req.session.student;
    

    try {
        const progressEp = `http://localhost:4000/student/${userID}/progress`;
        const progressResponse = await axios.get(progressEp);
        //console.log("Student progression data:", response.data);

        const studentEp = `http://localhost:4000/student/${userID}`;
        const studentResponse = await axios.get(studentEp);

        res.render("studentprogression", { progress: progressResponse.data, student: studentResponse.data });
    }catch (err) {
        res.send("Error fetching progression data" + err);
    }

});

//Admin dashboard
app.get("/admindashboard", async (req, res) => {
    if (!req.session.student) {
        return res.redirect("/");
    }

    const userID = req.session.student;
    const ep = `http://localhost:4000/student/${userID}`;
    const config = { headers: { "Content-Type": "application/x-www-form-urlencoded" } };

    try {
        const response = await axios.get(ep, config);
        //const adminData = response.data;

        if(response.data.error){
            return res.redirect("/?error=notadmin");
        }
        //console.log("Admin data:", response.data);
        res.render("admindash", { admin: response.data });
    }catch (err) {
        res.send("Error fetching admin data" + err);
    }
});

//Student management
app.get("/studentmgmt", async (req, res) => {
    if (!req.session.student) {
        return res.redirect("/");
    }

    const userID = req.session.student;
    const page = req.query.page || 1; // Get the page number from the query.
    const adminEp = `http://localhost:4000/admin/${userID}/dashboard`;
    const studentsEp = `http://localhost:4000/admin/${userID}/students?page=${page}`;
    const config = { headers: { "Content-Type": "application/x-www-form-urlencoded" } };

    try {
        //Admin data for sidebar
        const adminResponse = await axios.get(adminEp, config);        
        if(adminResponse.data.error){
            return res.redirect("/?error=notadmin");
        }

        //student data for table
        const studentResponse = await axios.get(studentsEp, config);
        if(studentResponse.data.error){
            return res.redirect("/?error=notadmin");
        }
        
        res.render("studentmgmt", { admin: adminResponse.data, 
                                    students: studentResponse.data.students,
                                    currentPage: studentResponse.data.pagination.currentPage,
                                    totalPages: studentResponse.data.pagination.totalPages,
                                    totalStudents: studentResponse.data.pagination.totalStudents,   
                                });
        
    }catch (err) {
        res.send("Error fetching student management data" + err);
    }   
});

// Logout
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

app.listen(3000, () => {
    console.log("Listening on localhost:3000");
});