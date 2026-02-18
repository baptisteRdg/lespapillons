const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Supprimer les données existantes
  await prisma.favorite.deleteMany();
  await prisma.activity.deleteMany();

  // Créer les activités de test
  const louvre = await prisma.activity.create({
    data: {
      name: 'Musée du Louvre',
      type: 'musée',
      latitude: 48.8606,
      longitude: 2.3376,
      address: 'Rue de Rivoli, 75001 Paris',
      phone: '+33 1 40 20 50 50',
      website: 'https://www.louvre.fr',
      description: 'Le plus grand musée d\'art au monde, abritant des milliers d\'œuvres dont la Joconde.',
      openingHours: '9h-18h (fermé le mardi)'
    }
  });

  const buttes = await prisma.activity.create({
    data: {
      name: 'Parc des Buttes-Chaumont',
      type: 'parc',
      latitude: 48.8784,
      longitude: 2.3922,
      address: '1 Rue Botzaris, 75019 Paris',
      website: 'https://www.paris.fr/equipements/parc-des-buttes-chaumont-18536',
      description: 'Un parc pittoresque avec des falaises, un lac et un temple de la Sibylle offrant une vue panoramique.',
      openingHours: '7h-22h'
    }
  });

  console.log('✅ Created activities:', { louvre: louvre.id, buttes: buttes.id });
  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
