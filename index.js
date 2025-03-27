require("./db");
const express = require('express');
const parser = require('body-parser');
const cors = require('cors');
const { signin, form, head_cat, sub_cat, month, department, vehicle, employee, fy_year} = require('./schema');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const { parse, isValid, format } = require('date-fns');
const sharp = require('sharp');

const app = express();

const monthOrder = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

app.use(cors());
app.use(parser.urlencoded({ extended: true }));
app.use(parser.json());
app.use(express.static('public'));


// Signin process
app.post('/signin', async (req, res) => {
    try {
        const user = req.body.username;
        const pass = req.body.password;
        const preuser = await signin.findOne({ 
            '$and': [
                { "username": { '$eq': user } }, 
                { "password": { '$eq': pass } }
            ] 
        });

        if (preuser) {
            const cred = {
                "username": user,
                "password": pass,
                "admin": preuser.admin  // Include admin status in the response
            };
            res.json(cred);
        } else {
            res.json({ "message": "error" });
        }
    } catch (err) {
        res.status(500).json({ "error": err });
    }
});



// Multer setup for storing files in `public/pdf`
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/pdf'));
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

const upload = multer({ storage });

// POST route for form submission
app.post('/postform', upload.array('files', 10), async (req, res) => {
    try {
        const {
            fy_year, month, head_cat, type, sub_cat, date,
            received_by, particulars, departments, vehicles, bills
        } = req.body;

        const uploadedFiles = req.files.map((file) => file.filename);

        // Parse JSON fields
        const parsedFyYear = JSON.parse(fy_year);
        const parsedMonth = JSON.parse(month);
        const parsedType = JSON.parse(type);
        const parsedHeadCat = JSON.parse(head_cat);
        const parsedSubCat = JSON.parse(sub_cat);
        const parsedReceivedBy = JSON.parse(received_by);
        const parsedDepartments = JSON.parse(departments);
        const parsedVehicles = JSON.parse(vehicles);
        const parsedBills = JSON.parse(bills);

        // Calculate TotalAmount
        const totalAmount = parsedBills.reduce((sum, bill) => sum + Number(bill.amount), 0);

        // Create unique merged PDF file name
        const billNo = parsedBills.map((bill) => bill.bill_no).join('_');
        const randomNumber = Math.floor(Math.random() * 10000);
        const mergedPdfFileName = `${billNo}_${date}_${randomNumber}.pdf`;
        const mergedPdfPath = path.join(__dirname, 'public/merged_pdf', mergedPdfFileName);

        const mergedPdfDoc = await PDFDocument.create();

        for (const file of req.files.map((file) => path.join(__dirname, 'public/pdf', file.filename))) {
            const ext = path.extname(file).toLowerCase();
            const A4_WIDTH = 595;  // A4 width in pixels
            const A4_HEIGHT = 842; // A4 height in pixels

            if (['.png', '.jpeg', '.jpg'].includes(ext)) {
                try {
                    // Resize image to fit within A4 size
                    const imageBuffer = await sharp(file)
                        .resize({ width: A4_WIDTH, height: A4_HEIGHT, fit: 'inside' }) // Maintain aspect ratio
                        .toBuffer();

                    let img;
                    if (ext === '.jpg' || ext === '.jpeg') {
                        img = await mergedPdfDoc.embedJpg(imageBuffer);
                    } else if (ext === '.png') {
                        img = await mergedPdfDoc.embedPng(imageBuffer);
                    }

                    const page = mergedPdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
                    const imgDims = img.scale(1);
                    const x = (A4_WIDTH - imgDims.width) / 2;
                    const y = (A4_HEIGHT - imgDims.height) / 2;

                    page.drawImage(img, { x, y, width: imgDims.width, height: imgDims.height });

                } catch (err) {
                    console.error('Error processing image:', err);
                }
            } else if (ext === '.pdf') {
                // Merge PDF directly
                const pdfBytes = fs.readFileSync(file);
                const pdfDoc = await PDFDocument.load(pdfBytes);
                const copiedPages = await mergedPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
                copiedPages.forEach((page) => mergedPdfDoc.addPage(page));
            }
        }

        // Save the merged PDF
        const mergedPdfBytes = await mergedPdfDoc.save();
        fs.writeFileSync(mergedPdfPath, mergedPdfBytes);

        // Store only file name for the merged PDF
        const mergedPdfFileNameOnly = path.basename(mergedPdfPath);

        // Save form entry
        const Form = new form({
            fy_year: parsedFyYear,
            month: parsedMonth,
            head_cat: parsedHeadCat,
            type: parsedType,
            sub_cat: parsedSubCat,
            date,
            received_by: parsedReceivedBy,
            particulars,
            departments: parsedDepartments,
            vehicles: parsedVehicles,
            bills: parsedBills,
            file: uploadedFiles, // Store file names only
            merged_pdf: mergedPdfFileNameOnly, // Store merged PDF file name only
            TotalAmount: totalAmount, // Store the correct total amount
        });

        await Form.save();

        res.status(200).json({ message: 'Form submitted successfully', Form });
    } catch (error) {
        console.error('Error submitting form:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});



// Get forms
app.get('/getforms', async (req, res) => {
    try {
        const data = await form.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

// GET FORM DATA BY FY YEAR AND MONTH 

app.get('/fy_year_month/:fy_year/:month', async (req, res) => {
    const { fy_year, month } = req.params;
    try {
        // Find the forms where fy_name and month_name match the request params
        const found = await form.find({
            'fy_year.fy_name': Number(fy_year),
            'month.month_name': month
        });

        // Return the found forms
        res.json(found);
    } catch (error) {
        // Handle errors and respond with an error message
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

//Filter by from-date & to-date
app.get('/date_filter/:from/:to', async (req, res) => {
    const { from, to } = req.params;

    // Validate date format using a regular expression for 'dd-MM-yyyy'
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
        return res.status(400).json({ error: 'Invalid date format. Use dd-MM-yyyy' });
    }

    try {
        // Query the 'form' collection and filter by the date range (string comparison)
        const found = await form.find({
            date: { $gte: from, $lte: to }
        });

        // Return the found forms
        res.json(found);
    } catch (error) {
        console.error('Error fetching forms:', error);
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

// FILTER FOR BILL NO

app.get('/getFormsByBillNos', async (req, res) => {
  try {
    // Extract bill numbers from the query parameters
    const billNos = req.query.bill_nos ? req.query.bill_nos.split(',') : [];

    if (billNos.length === 0) {
      return res.status(400).json({ error: 'No bill numbers provided' });
    }

    // Query the database to filter forms based on the provided bill numbers
    const forms = await form.find({
      'bills.bill_no': { $in: billNos },
    });

    // Return the filtered forms
    res.json(forms);
  } catch (error) {
    console.error('Error fetching forms by bill numbers:', error);
    res.status(500).json({ error: 'Failed to retrieve forms' });
  }
});




// FORM FY YEAR DROP DOWN 

app.get('/getfyyearoption', async (req, res) => {
    try {
        // Fetch all documents from fy_year collection
        const data = await fy_year.find({}, { _id: 0 }).exec();

        // Sort the data by fy_name in ascending order
        const sortedFyYears = data.sort((a, b) => {
            const [startA] = a.fy_name.split('-').map(String);
            const [startB] = b.fy_name.split('-').map(String);
            return startA - startB;
        });

        // Return the sorted data as JSON
        res.json(sortedFyYears);
    } catch (error) {
        console.error('Error fetching financial years:', error);
        res.status(500).json({ error: 'Failed to retrieve financial year data' });
    }
});



// FORM MONTH DROP DOWN 

app.get('/getmonthoption', async (req, res) => {
    try {
        // Define the order of months
        const monthOrder = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];

        // Fetch only the month field from the documents
        const data = await form.find({}, { month: 1, _id: 0 }).exec();

        // Extract unique months based on the month_name field
        const uniqueMonths = Array.from(
            new Map(data.map(doc => [doc.month.month_name, doc.month])).values()
        );

        // Sort unique months based on the predefined order
        const sortedMonths = uniqueMonths.sort((a, b) => {
            return monthOrder.indexOf(a.month_name) - monthOrder.indexOf(b.month_name);
        });

        // Map sorted months to the desired format
        const formattedData = sortedMonths.map(month => ({ month }));

        // Return the formatted data as a JSON array
        res.json(formattedData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve months' });
    }
});



// Get form by various filters
app.get('/amount/:given', async (req, res) => {
    try {
        const found = await form.find({ "amount": { '$eq': req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/particulars/:given', async (req, res) => {
    try {
        const searchTerm = req.params.given;
        const found = await form.find({
            particulars: { $regex: searchTerm, $options: 'i' } // Case-insensitive search
        });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});


// Get form by various filters FOR FY YEAR 
app.get('/fy_year/:given', async (req, res) => {
    try {
        const found = await form.find({ "fy_year.fy_name": { '$eq':req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/month/:given', async (req, res) => {
    try {
        const found = await form.find({ "month.month_name": { '$eq': req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/date/:given', async (req, res) => {
    try {
        const found = await form.find({ "date": { '$eq': req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/getFormByHeadCatName/:head_cat_name', async (req, res) => {
    try {
        const forms = await form.find({
            'head_cat.head_cat_name': req.params.head_cat_name,
        });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

// FILTER FOR TYPE 

app.get('/getFormByType/:type', async (req, res) => {
    try {
      const forms = await form.find({
        type: req.params.type,
      });
      res.json(forms);
    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve forms' });
    }
  });

app.get('/getFormBySubCatName/:sub_cat_name', async (req, res) => {
    try {
        const forms = await form.find({
            'sub_cat.sub_cat_name': req.params.sub_cat_name,
        });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/getFormByVehicleID/:vehicle_id', async (req, res) => {
    try {
        const vehicleId = Number(req.params.vehicle_id);
        const forms = await form.find({
            'vehicles.vehicle_id': vehicleId,
        });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

// EMPLOYEE ID FILTER 
app.get('/getFormsByEmployeeIDs', async (req, res) => {
    try {
        const empIDs = req.query.emp_ids; // Expecting a comma-separated string
        if (!empIDs) {
            return res.status(400).json({ error: 'No employee IDs provided' });
        }

        // Convert the comma-separated string into an array
        const empIDArray = empIDs.split(',').map(id => id.trim());

        // Query the database using $elemMatch to filter nested arrays
        const forms = await form.find({
            received_by: {
                $elemMatch: { emp_id: { $in: empIDArray } },
            },
        });

        // Send the results back
        res.json(forms);
    } catch (error) {
        console.error('Error retrieving forms:', error.message);
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});




// Get head category
app.get('/gethead_cat', async (req, res) => {
    try {
        const data = await head_cat.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve head_cat' });
    }
});

// Get sub category
app.get('/getsub_cat', async (req, res) => {
    try {
        const data = await sub_cat.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve sub_cat' });
    }
});

// Get month


app.get('/getmonth', async (req, res) => {
    try {
        // Retrieve all months from the database
        const data = await month.find();
        
        // Sort the data based on the custom month order
        const sortedData = data.sort((a, b) => {
            return monthOrder.indexOf(a.month_name) - monthOrder.indexOf(b.month_name);
        });

        res.json(sortedData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve month' });
    }
});


// Get department
app.get('/getdepartment', async (req, res) => {
    try {
        const data = await department.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve department' });
    }
});

// Get employee
app.get('/getemployee', async (req, res) => {
    try {
        const data = await employee.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve employee' });
    }
});

// Get vehicle
app.get('/getvehicle', async (req, res) => {
    try {
        const data = await vehicle.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve vehicle' });
    }
});

// Get financial year FROM FY YEAR COLLECTION

app.get('/getfy_year', async (req, res) => {
    try {
        const fy_year_data = await fy_year.find();
        res.json(fy_year_data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve fy_year' });
    }
});


// FY YEAR ADMIN 

// Activate Fiscal Year (Set fy_id to true)
app.post('/settruefyyear', async (req, res) => {
    let { fy_name } = req.body;

    // Validate the input (must be a string)
    if (typeof fy_name !== 'string' || !fy_name.trim()) {
        return res.status(400).send('Invalid input: fy_name must be a non-empty string');
    }

    try {
        // Find or create fiscal year, set fy_id to true (active)
        const fyYear = await fy_year.findOneAndUpdate(
            { fy_name: fy_name.trim() },
            { fy_id: true },
            { new: true, upsert: true } // upsert creates a new document if none is found
        );

        res.json(fyYear);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});

// Deactivate Fiscal Year (Set fy_id to false) 
app.post('/setfalsefyyear', async (req, res) => {
    let { fy_name } = req.body;

    // Validate the input (must be a string)
    if (typeof fy_name !== 'string' || !fy_name.trim()) {
        return res.status(400).send('Invalid input: fy_name must be a non-empty string');
    }

    try {
        // Find or create fiscal year, set fy_id to false (inactive)
        const fyYear = await fy_year.findOneAndUpdate(
            { fy_name: fy_name.trim() },
            { fy_id: false },
            { new: true, upsert: true } // upsert creates a new document if none is found
        );

        res.json(fyYear);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});

// MONTH FOR ADMIN

 // TRUE MONTH ADMIN
app.post('/setmonthtrue', async (req, res) => {
    const { month_name } = req.body;
 

    // Validate the input
    if (typeof month_name !== 'string') {
        return res.status(400).send('Invalid input: month_name must be a string');
    }

    try {
        // Find or create month and set month_id to true
        const monthDoc = await month.findOneAndUpdate(
            { month_name },
            { month_id: true }, // Set month_id to true
            { new: true, upsert: true } // upsert creates a new document if none is found
        );

        res.json(monthDoc);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});

// FALSE MONTH ADMIN
app.post('/setmonthfalse', async (req, res) => {
    const { month_name } = req.body;

    // Validate the input
    if (typeof month_name !== 'string') {
        return res.status(400).send('Invalid input: month_name must be a string');
    }

    try {
        // Find or create month and set month_id to false
        const monthDoc = await month.findOneAndUpdate(
            { month_name },
            { month_id: false }, // Set month_id to false
            { new: true, upsert: true } // upsert creates a new document if none is found
        );

        res.json(monthDoc);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});

// ADMIN MONTH ACTIVATION BASED ON FY YEAR
app.post('/activateMonth', async (req, res) => {
    const { fy_name, month_name } = req.body;

    if (typeof fy_name !== 'string' || typeof month_name !== 'string') {
        return res.status(400).send('Invalid input: fy_name and month_name must be strings');
    }

    try {
        // Try to activate the month if it exists
        const updatedFyYear = await fy_year.findOneAndUpdate(
            { fy_name, "months.month_name": month_name },
            { $set: { "months.$.month_id": true } },
            { new: true }
        );

        // If the month doesn't exist, push it to the months array
        if (!updatedFyYear) {
            const fyExists = await fy_year.findOneAndUpdate(
                { fy_name },
                { $push: { months: { month_name, month_id: true } } },
                { new: true, upsert: true }
            );

            return res.json(fyExists);
        }

        res.json(updatedFyYear);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});


//ADMIN MONTH LOCK BASED ON FY YEAR

// ADMIN MONTH LOCK BASED ON FY YEAR
app.post('/lockMonth', async (req, res) => {
    const { fy_name, month_name } = req.body;

    if (typeof fy_name !== 'string' || typeof month_name !== 'string') {
        return res.status(400).send('Invalid input: fy_name and month_name must be strings');
    }

    try {
        // Try to lock the month if it exists
        const updatedFyYear = await fy_year.findOneAndUpdate(
            { fy_name, "months.month_name": month_name },
            { $set: { "months.$.month_id": false } },
            { new: true }
        );

        // If the month doesn't exist, push it as locked
        if (!updatedFyYear) {
            const fyExists = await fy_year.findOneAndUpdate(
                { fy_name },
                { $push: { months: { month_name, month_id: false } } },
                { new: true, upsert: true }
            );

            return res.json(fyExists);
        }

        res.json(updatedFyYear);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});




app.delete('/erase/:id', async (request, response) => {
    try {
        // Find the document by ID and delete it
        const data = await form.findByIdAndDelete(request.params.id);

        if (!data) {
            return response.status(404).json({ message: 'Data not found' });
        }

        // Extract file names from the document
        const { merged_pdf, file } = data;

        // Define directories for merged PDFs and uploaded files
        const mergedPdfDirectory = path.join(__dirname, 'public/merged_pdf');
        const fileDirectory = path.join(__dirname, 'public/pdf');

        // Delete the merged PDF file if it exists
        if (merged_pdf) {
            const mergedPdfFilePath = path.join(mergedPdfDirectory, merged_pdf); // Reconstruct the absolute path
            if (fs.existsSync(mergedPdfFilePath)) {
                fs.unlinkSync(mergedPdfFilePath);
                console.log(`Deleted merged PDF: ${mergedPdfFilePath}`);
            } else {
                console.log(`Merged PDF not found: ${mergedPdfFilePath}`);
            }
        }

        // Delete each uploaded file (individual files)
        if (file && Array.isArray(file)) {
            file.forEach((fileName) => {
                const filePath = path.join(fileDirectory, fileName); // Reconstruct the absolute path
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`Deleted file: ${filePath}`);
                } else {
                    console.log(`File not found: ${filePath}`);
                }
            });
        }

        // Respond with success message
        response.json({ message: 'Data and associated files deleted successfully', data });
    } catch (error) {
        console.error('Error deleting data and files:', error);
        response.status(500).json({ message: 'Internal server error', error });
    }
});


// MODIFY FORM
// PUT route for modifying a form
app.put('/modify', upload.array('files', 10), async (req, res) => {
    try {
        const {
            _id,
            fy_year,
            month,
            head_cat,
            sub_cat,
            date,
            received_by,
            particulars,
            departments,
            vehicles,
            bills
        } = req.body;

        // Helper to parse JSON safely
        const safeJsonParse = (data) => {
            try {
                return JSON.parse(data);
            } catch (error) {
                return null; // Return null if parsing fails
            }
        };

        // Parse JSON fields
        const parsedFyYear = safeJsonParse(fy_year);
        const parsedMonth = safeJsonParse(month);
        const parsedHeadCat = safeJsonParse(head_cat);
        const parsedSubCat = safeJsonParse(sub_cat);
        const parsedReceivedBy = safeJsonParse(received_by);
        const parsedDepartments = safeJsonParse(departments);
        const parsedVehicles = safeJsonParse(vehicles);
        const parsedBills = safeJsonParse(bills);

        // Validate required fields
        if (!_id) {
            return res.status(400).json({ message: 'ID is required to modify the form.' });
        }

        // Process uploaded files
        let mergedPdfFileName = null;
        if (req.files && req.files.length > 0) {
            const billNumbers = parsedBills.map((bill) => bill.bill_no).join('_');
            const todayDate = date || new Date().toISOString().split('T')[0];
            const randomNumber = Math.floor(Math.random() * 10000);
            mergedPdfFileName = `${billNumbers}_${todayDate}_${randomNumber}.pdf`;

            const outputPath = path.join(__dirname, 'public', 'merged_pdf', mergedPdfFileName);
            const mergedPdfDoc = await PDFDocument.create();

            for (const file of req.files.map((file) => path.join(__dirname, 'public/pdf', file.filename))) {
                const ext = path.extname(file).toLowerCase();

                if (['.png', '.jpeg', '.jpg'].includes(ext)) {
                    const imageBuffer = await sharp(file).toBuffer();

                    if (ext === '.jpg' || ext === '.jpeg') {
                        const img = await mergedPdfDoc.embedJpg(imageBuffer);
                        const page = mergedPdfDoc.addPage([img.width, img.height]);
                        page.drawImage(img, { x: 0, y: 0 });
                    } else if (ext === '.png') {
                        const img = await mergedPdfDoc.embedPng(imageBuffer);
                        const page = mergedPdfDoc.addPage([img.width, img.height]);
                        page.drawImage(img, { x: 0, y: 0 });
                    }
                } else if (ext === '.pdf') {
                    const pdfBytes = fs.readFileSync(file);
                    const pdfDoc = await PDFDocument.load(pdfBytes);
                    const copiedPages = await mergedPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
                    copiedPages.forEach((page) => mergedPdfDoc.addPage(page));
                }
            }

            const mergedPdfBytes = await mergedPdfDoc.save();
            fs.writeFileSync(outputPath, mergedPdfBytes);
        }

        // Calculate TotalAmount
        const totalAmount = parsedBills.reduce((sum, bill) => sum + Number(bill.amount), 0);

        // Build updated form data
        const updateData = {
            fy_year: parsedFyYear,
            month: parsedMonth,
            head_cat: parsedHeadCat,
            sub_cat: parsedSubCat,
            date,
            received_by: parsedReceivedBy,
            particulars,
            departments: parsedDepartments,
            vehicles: parsedVehicles,
            bills: parsedBills,
            TotalAmount: totalAmount,
            merged_pdf: mergedPdfFileName || undefined,
            file: req.files ? req.files.map((file) => file.filename) : undefined // Update uploaded file names
        };

        // Update the form in the database
        const updatedForm = await form.findByIdAndUpdate(_id, updateData, {
            new: true, // Return the updated document
            runValidators: true // Ensure schema validators are applied
        });

        // Check if the document was found and updated
        if (!updatedForm) {
            return res.status(404).json({ message: 'Form not found.' });
        }

        res.status(200).json({ message: 'Form updated successfully', updatedForm });
    } catch (error) {
        console.error('Error updating form:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// GET FORM BY ID 
app.get('/getforms/:id', async (req, res) => {
    try {
      const formId = req.params.id; 
      const formdata = await form.findById(formId);
      if (!formdata) {
        return res.status(404).json({ message: 'Form not found' });
      }
      res.status(200).json(formdata);
    } catch (error) {
      console.error('Error fetching form data:', error);
      res.status(500).json({ message: 'Server error', error });
    }
  });

//   GET MONTH BASED ON FY YEAR FROM FY YEAR COLLECTION 


app.get('/getMonthsFromFyYear/:fy_name', async (req, res) => {
    try {
      const { fy_name } = req.params;
      const fyYear = await fy_year.findOne({ fy_name });
  
      if (!fyYear) {
        return res.status(404).json({ message: 'Financial year not found' });
      }
  
      // Filter only active months
      const activeMonths = fyYear.months.filter(month => month.month_id);
  
      // Sort active months based on monthOrder
      activeMonths.sort((a, b) => monthOrder.indexOf(a.month_name) - monthOrder.indexOf(b.month_name));
  
      res.json({ fy_name: fyYear.fy_name, months: activeMonths });
    } catch (error) {
      res.status(500).json({ message: 'Server error', error });
    }
  });

//   GET FY YEAR FROM THE FORM FOR CS

app.get("/forms_fy_year", async (req, res) => {
    try {
      const uniqueFyYears = await form.aggregate([
        {
          $group: {
            _id: "$fy_year._id",
            fy_name: { $first: "$fy_year.fy_name" },
          },
        },
        {
          $sort: { fy_name: 1 }, // Sort by fiscal year name if needed
        },
      ]);
  
      res.json(uniqueFyYears);
    } catch (error) {
      console.error("Error fetching unique fiscal years:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
//   TESTING 

app.get('/', (req, res) => {
    res.send('Welcome to the Drug Interaction API! Use /interactions or /interactions/single.');
  });

app.listen(1111, () => {
    console.log("Express connected!!!");
});