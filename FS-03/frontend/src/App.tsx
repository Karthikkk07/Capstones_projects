import { Route, Routes, useParams } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { RequireAuth } from './components/RequireAuth';
import { AdminPage } from './pages/AdminPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CatalogPage } from './pages/CatalogPage';
import { CourseDetailPage } from './pages/CourseDetailPage';
import { CourseEditorPage } from './pages/CourseEditorPage';
import { DashboardPage, VerifyCertificatePage } from './pages/DashboardPage';
import { InstructorCoursesPage } from './pages/InstructorCoursesPage';
import { LessonPlayerPage } from './pages/LessonPlayerPage';
import { LiveRoomPage } from './pages/LiveRoomPage';
import { QuizPage } from './pages/QuizPage';
import { RevenuePage } from './pages/RevenuePage';

function VerifyRoute() {
  const { code = '' } = useParams();
  return <VerifyCertificatePage code={code} />;
}

export default function App() {
  const teacher = ['INSTRUCTOR', 'ADMIN'] as const;
  return (
    <>
      <Navbar />
      <main className="page">
        <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/courses/:slug" element={<CourseDetailPage />} />
          <Route path="/verify/:code" element={<VerifyRoute />} />

          <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/learn/:courseId" element={<RequireAuth><LessonPlayerPage /></RequireAuth>} />
          <Route path="/learn/:courseId/:lessonId" element={<RequireAuth><LessonPlayerPage /></RequireAuth>} />
          <Route path="/quiz/:id" element={<RequireAuth><QuizPage /></RequireAuth>} />
          <Route path="/live/:id" element={<RequireAuth><LiveRoomPage /></RequireAuth>} />

          <Route path="/instructor" element={<RequireAuth roles={[...teacher]}><InstructorCoursesPage /></RequireAuth>} />
          <Route path="/instructor/courses/:id" element={<RequireAuth roles={[...teacher]}><CourseEditorPage /></RequireAuth>} />
          <Route path="/instructor/revenue" element={<RequireAuth roles={[...teacher]}><RevenuePage /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth roles={['ADMIN']}><AdminPage /></RequireAuth>} />

          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
