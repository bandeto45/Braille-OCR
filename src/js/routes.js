
import PreloaderPage from '../pages/preloader.f7';
import HomePage      from '../pages/home.f7';
import CameraPage    from '../pages/camera.f7';
import SettingsPage  from '../pages/settings.f7';
import AboutPage     from '../pages/about.f7';
import NotFoundPage  from '../pages/404.f7';

var routes = [
  { path: '/',          component: PreloaderPage },
  { path: '/home/',     component: HomePage },
  { path: '/camera/',   component: CameraPage },
  { path: '/settings/', component: SettingsPage },
  { path: '/about/',    component: AboutPage },
  { path: '(.*)',       component: NotFoundPage },
];

export default routes;