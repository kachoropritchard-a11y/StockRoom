import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="spinner-page">
      <div>
        <h1>Page not found</h1>
        <Link to="/">Go to your dashboard</Link>
      </div>
    </div>
  );
}
