require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "swappy_db",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "",
});

const USERS = [
  { name: "Krishna Yadav",  phone: "9876543210", city: "Bengaluru", location: "Koramangala, Bengaluru", avatar: "KY", rating: 4.8, reviews: 23 },
  { name: "Arjun Sharma",   phone: "9876543211", city: "Bengaluru", location: "Koramangala, Bengaluru", avatar: "AS", rating: 4.8, reviews: 23 },
  { name: "Priya Mehta",    phone: "9876543212", city: "Bengaluru", location: "HSR Layout, Bengaluru",  avatar: "PM", rating: 4.6, reviews: 11 },
  { name: "Rahul Kumar",    phone: "9876543213", city: "Bengaluru", location: "Whitefield, Bengaluru",  avatar: "RK", rating: 4.9, reviews: 34 },
  { name: "Sneha Lal",      phone: "9876543214", city: "Bengaluru", location: "Indiranagar, Bengaluru", avatar: "SL", rating: 4.7, reviews: 8  },
  { name: "Vikram Patel",   phone: "9876543215", city: "Bengaluru", location: "JP Nagar, Bengaluru",    avatar: "VP", rating: 4.5, reviews: 17 },
  { name: "Ananya Rao",     phone: "9876543216", city: "Bengaluru", location: "Electronic City",        avatar: "AR", rating: 4.3, reviews: 6  },
  { name: "Dev Chandra",    phone: "9876543217", city: "Bengaluru", location: "Marathahalli",           avatar: "DC", rating: 4.9, reviews: 41 },
];

const ITEMS = [
  { title: "Sony WH-1000XM4 Headphones",  category: "Electronics", condition: "Like New", band: "C", original_price: 8000,  wants: "Camera / Lens / Tablet",            emoji: "🎧", user_idx: 1, description: "Bought 8 months ago, barely used. Original box, cable, carry case included." },
  { title: "IKEA MICKE Desk + Chair Set",  category: "Furniture",   condition: "Good",     band: "B", original_price: 3000,  wants: "Monitor / Laptop Stand / Books",     emoji: "🪑", user_idx: 2, description: "Study desk 73x50cm. Minor surface scratch on corner. Easy to disassemble." },
  { title: "Canon EOS M50 Mark II",        category: "Electronics", condition: "Excellent",band: "D", original_price: 20000, wants: "Gaming Console / MacBook / iPad Pro", emoji: "📷", user_idx: 3, description: "With 15-45mm lens, 2 batteries, 32GB SD card. Shutter count under 3000." },
  { title: "Trek FX2 Hybrid Bicycle",      category: "Sports",      condition: "Good",     band: "D", original_price: 15000, wants: "Scooter / Laptop / Gym Equipment",    emoji: "🚴", user_idx: 4, description: "21-speed hybrid bike, size M. Serviced 2 months ago. New tyres." },
  { title: "Dyson TP07 Air Purifier",      category: "Appliances",  condition: "Like New", band: "D", original_price: 22000, wants: "TV / Soundbar / Home Appliance",      emoji: "💨", user_idx: 5, description: "Used 4 months. Filter life 85%. Original remote included." },
  { title: "MBA Textbooks Set (14 books)", category: "Books",       condition: "Good",     band: "A", original_price: 800,   wants: "Fiction Books / Journals / Kindle",   emoji: "📚", user_idx: 6, description: "Complete 1st year MBA set. Some highlighted, no torn pages." },
  { title: "PS5 + 3 Games Bundle",         category: "Electronics", condition: "Like New", band: "E", original_price: 55000, wants: "MacBook Pro / iPhone 15 / Camera",    emoji: "🎮", user_idx: 7, description: "Disc edition. FIFA 24, Spider-Man 2, God of War Ragnarok. Warranty valid." },
  { title: "FlexiSpot E7 Standing Desk",   category: "Furniture",   condition: "Excellent",band: "C", original_price: 7500,  wants: "Laptop / Gaming Chair / Monitor 27\"",emoji: "🖥️", user_idx: 0, description: "Electric height-adjustable. 140x70cm tabletop. Memory presets." },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🌱 Seeding database...\n");
    const userIds = [];

    for (const u of USERS) {
      const res = await client.query(
        `INSERT INTO users (name, phone, city, location, avatar_initials, rating, review_count, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [u.name, u.phone, u.city, u.location, u.avatar, u.rating, u.reviews]
      );
      userIds.push(res.rows[0].id);
      console.log(`  ✓ User: ${u.name} (${u.phone})`);
    }

    for (const item of ITEMS) {
      await client.query(
        `INSERT INTO items (user_id, title, description, category, condition, band, original_price, wants, emoji, status, city)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','Bengaluru')
         ON CONFLICT DO NOTHING`,
        [userIds[item.user_idx], item.title, item.description,
         item.category, item.condition, item.band, item.original_price,
         item.wants, item.emoji]
      );
      console.log(`  ✓ Item: ${item.title}`);
    }

    console.log("\n✅ Seed complete!");
    console.log("\n📱 Test login phones (OTP in dev mode = 123456):");
    USERS.forEach(u => console.log(`   ${u.phone}  —  ${u.name}`));
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
