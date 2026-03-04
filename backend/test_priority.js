const API_URL = "http://localhost:8080";
const axios = require('axios');

async function testPriority() {
    try {
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: "admin@crm.com",
            password: "password123"
        });

        const token = loginRes.data.token;
        const axiosInstance = axios.create({
            headers: { Authorization: `Bearer ${token}` }
        });

        // 1. Create a lead with 3 contacts, set middle as primary
        const leadPayload = {
            company_name: "Priority Test Inc",
            contacts: [
                { name: "John", phone: "1234567890" },
                { name: "Jane", phone: "0987654321", is_primary: true },
                { name: "Bob", phone: "5555555555" }
            ]
        };

        const leadRes = await axiosInstance.post(`${API_URL}/leads`, leadPayload);
        const leadId = leadRes.data._id;
        console.log("Created lead:", leadId);

        // Fetch lead back and check contacts
        const getRes = await axiosInstance.get(`${API_URL}/leads/${leadId}`);
        const savedContacts = getRes.data.contacts;

        console.log("Saved contacts:", savedContacts.map(c => `${c.name} - Primary: ${c.is_primary}`));

        const actualPrimary = savedContacts.find(c => c.is_primary);
        if (actualPrimary && actualPrimary.name === "Jane") {
            console.log("✅ Priority contact successfully preserved for lead");
        } else {
            console.log("❌ Priority contact failed for lead");
        }

    } catch (err) {
        console.log("Error details:", err);
    }
}

testPriority();
