const normalizePhone = (phone) => {
    if (!phone) return null;

    return String(phone)
        .replace(/[^\d]/g, "") // remove +, spaces, dashes
        .trim();
};

module.exports = {
    normalizePhone,
};
