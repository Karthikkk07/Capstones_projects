/* Dev seed: `npm run seed`. Wipes all tables and inserts demo data. */
import { faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { slugify } from '../src/lib/slug';
import { generateCertificateCode } from '../src/services/certificates';
import { splitRevenue } from '../src/services/revenue';

const prisma = new PrismaClient();
const SHARE_PCT = Number(process.env.INSTRUCTOR_SHARE_PCT ?? 80);
const PASSWORD = 'Password123!';
const CATEGORIES = ['Web Development', 'Data Science', 'Design', 'DevOps', 'Business'];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  faker.seed(42);

  for (const del of [
    prisma.chatMessage.deleteMany(),
    prisma.liveClass.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.payout.deleteMany(),
    prisma.certificate.deleteMany(),
    prisma.quizAttempt.deleteMany(),
    prisma.question.deleteMany(),
    prisma.quiz.deleteMany(),
    prisma.lessonProgress.deleteMany(),
    prisma.enrollment.deleteMany(),
    prisma.lesson.deleteMany(),
    prisma.section.deleteMany(),
    prisma.course.deleteMany(),
    prisma.user.deleteMany(),
  ]) {
    await del;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@lms.test', name: 'Platform Admin', role: 'ADMIN', passwordHash: await bcrypt.hash('Admin123!', 10) },
  });

  const instructors = [];
  for (let i = 1; i <= 3; i++) {
    instructors.push(
      await prisma.user.create({
        data: { email: `instructor${i}@lms.test`, name: faker.person.fullName(), role: 'INSTRUCTOR', passwordHash },
      }),
    );
  }
  const students = [];
  for (let i = 1; i <= 12; i++) {
    students.push(
      await prisma.user.create({
        data: { email: `student${i}@lms.test`, name: faker.person.fullName(), role: 'STUDENT', passwordHash },
      }),
    );
  }

  const courses = [];
  for (let c = 0; c < 8; c++) {
    const instructor = instructors[c % instructors.length];
    const title = `${faker.helpers.arrayElement(['Mastering', 'Introduction to', 'Practical', 'Advanced'])} ${faker.word.noun()} ${faker.word.adjective()}`.replace(/\b\w/g, (m) => m.toUpperCase());
    const priceCents = c % 3 === 0 ? 0 : faker.helpers.arrayElement([1999, 2999, 4999, 9900]);
    const course = await prisma.course.create({
      data: {
        title,
        slug: `${slugify(title)}-${c}`,
        description: faker.lorem.paragraphs(2),
        priceCents,
        category: CATEGORIES[c % CATEGORIES.length],
        status: c === 7 ? 'DRAFT' : 'PUBLISHED',
        thumbnail: `https://picsum.photos/seed/lms${c}/640/360`,
        instructorId: instructor.id,
      },
    });

    for (let s = 0; s < 2; s++) {
      const section = await prisma.section.create({ data: { courseId: course.id, title: `Module ${s + 1}: ${faker.lorem.words(3)}`, position: s } });
      for (let l = 0; l < 3; l++) {
        const isVideo = l === 0;
        await prisma.lesson.create({
          data: {
            courseId: course.id,
            sectionId: section.id,
            title: faker.lorem.words({ min: 2, max: 5 }),
            position: l,
            type: isVideo ? 'VIDEO' : 'TEXT',
            content: isVideo ? null : faker.lorem.paragraphs(3),
            // Demo HLS: drop a transcoded folder at media/hls/demo to make seeded videos playable locally.
            videoStatus: 'READY',
            hlsPath: isVideo ? 'hls/demo/master.m3u8' : null,
            durationSec: isVideo ? faker.number.int({ min: 240, max: 900 }) : null,
          },
        });
      }
    }

    const quiz = await prisma.quiz.create({
      data: { courseId: course.id, title: `${title} - Final Quiz`, passMarkPct: 60, maxAttempts: 5, required: true },
    });
    await prisma.question.createMany({
      data: [
        {
          quizId: quiz.id,
          type: 'SINGLE',
          prompt: 'Which option is correct?',
          options: [{ id: 'a', text: 'Option A' }, { id: 'b', text: 'Option B' }, { id: 'c', text: 'Option C' }],
          correct: ['b'],
          points: 2,
          position: 0,
        },
        {
          quizId: quiz.id,
          type: 'MULTIPLE',
          prompt: 'Select all that apply.',
          options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }, { id: 'c', text: 'Gamma' }, { id: 'd', text: 'Delta' }],
          correct: ['a', 'c'],
          points: 3,
          position: 1,
        },
        {
          quizId: quiz.id,
          type: 'TRUE_FALSE',
          prompt: 'This course is awesome.',
          options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }],
          correct: ['true'],
          points: 1,
          position: 2,
        },
      ],
    });
    courses.push({ ...course, quizId: quiz.id });
  }

  const published = courses.filter((c) => c.status === 'PUBLISHED');
  let payments = 0;
  for (const [i, student] of students.entries()) {
    for (const course of faker.helpers.arrayElements(published, { min: 1, max: 3 })) {
      await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
      if (course.priceCents > 0) {
        const split = splitRevenue(course.priceCents, SHARE_PCT);
        await prisma.payment.create({
          data: {
            userId: student.id,
            courseId: course.id,
            instructorId: course.instructorId,
            stripeSessionId: `cs_seed_${i}_${course.id}`,
            amountCents: split.amountCents,
            instructorShareCents: split.instructorShareCents,
            platformFeeCents: split.platformFeeCents,
            status: 'COMPLETED',
            createdAt: faker.date.recent({ days: 150 }),
          },
        });
        payments++;
      }
      const lessons = await prisma.lesson.findMany({ where: { courseId: course.id } });
      const doneCount = faker.number.int({ min: 0, max: lessons.length });
      for (const lesson of lessons.slice(0, doneCount)) {
        await prisma.lessonProgress.create({
          data: { userId: student.id, courseId: course.id, lessonId: lesson.id, completed: true, completedAt: new Date(), positionSec: 0 },
        });
      }
      if (doneCount === lessons.length) {
        await prisma.quizAttempt.create({
          data: { quizId: course.quizId, userId: student.id, answers: {}, score: 6, maxScore: 6, percent: 100, passed: true },
        });
        await prisma.certificate.create({ data: { userId: student.id, courseId: course.id, code: generateCertificateCode() } });
        await prisma.enrollment.updateMany({ where: { userId: student.id, courseId: course.id }, data: { completedAt: new Date() } });
      }
    }
  }

  const live = published[0];
  await prisma.liveClass.create({
    data: {
      courseId: live.id,
      title: 'Live Q&A session',
      scheduledAt: faker.date.soon({ days: 3 }),
      roomName: `lms-${live.id}-seed`,
    },
  });

  console.log(`Seeded: 1 admin, ${instructors.length} instructors, ${students.length} students, ${courses.length} courses, ${payments} payments.`);
  console.log(`Logins -> admin@lms.test / Admin123!  |  instructor1@lms.test, student1@lms.test / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
