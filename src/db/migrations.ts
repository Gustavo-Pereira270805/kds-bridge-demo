import db from './client';

export function createTables() {
    const createProductsTable = `
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            unit TEXT NOT NULL,
            active INTEGER DEFAULT 1
    );
`;
    const createDemandsTable = `
    CREATE TABLE IF NOT EXISTS demands(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      notes TEXT,
      completed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );
`;
    const createDailyMenusTable = `
    CREATE TABLE IF NOT EXISTS daily_menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      menu_name TEXT NOT NULL
    );
  `;
  db.exec(createProductsTable);
  db.exec(createDemandsTable);
  db.exec(createDailyMenusTable);
}