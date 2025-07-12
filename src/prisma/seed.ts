import { PrismaClient, Category, AisleFace } from "../../generated";
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

const categories: Category[] = [
  'FOOD_AND_FMCG',
  'STATIONERY',
  'ELECTRONICS_AND_ELECTRICAL_EQUIPMENT',
  'HARDWARE',
];

const getRandomCategory = (): Category =>
  categories[Math.floor(Math.random() * categories.length)];

const getRandomAisleFace = (): AisleFace =>
  Math.random() < 0.5 ? 'A' : 'B';

async function seed() {
  for (let i = 0; i < 10000; i++) {
    const category = getRandomCategory();
    const name = `${faker.commerce.productAdjective()} ${faker.commerce.productMaterial()} ${faker.commerce.product()}`;

    const product = await prisma.product.create({
      data: {
        name,
        isAvailable: Math.random() < 0.8, // 80% available
        category,
        productAdress: {
          create: {
            floor: faker.number.int({ min: 1, max: 5 }),
            latitude: faker.location.latitude().toString(),
            longitude: faker.location.longitude().toString(),
            aisle_face: getRandomAisleFace(),
            shelf: faker.number.int({ min: 1, max: 10 }),
            start_position: faker.number.int({ min: 1, max: 40 }),
            end_position: faker.number.int({ min: 41, max: 80 }),
          },
        },
      },
    });

    if (i % 1000 === 0) {
      console.log(`Inserted ${i} products...`);
    }
  }
}

seed()
  .then(() => {
    console.log('✅ Seeding completed.');
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    return prisma.$disconnect();
  });
