import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import * as authService from '../services/authService';

jest.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

jest.mock('../services/authService', () => ({
  ...jest.requireActual('../services/authService'),
  login: jest.fn(),
}));

const mockLogin = authService.login as jest.MockedFunction<typeof authService.login>;

function renderLoginPage(onLogin = jest.fn()) {
  return render(<LoginPage onLogin={onLogin} />);
}

describe('LoginPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders email and password inputs', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('submit button is disabled while form is submitting', async () => {
    let resolveLogin: (value: any) => void;
    mockLogin.mockImplementationOnce(
      () => new Promise((res) => { resolveLogin = res; })
    );

    renderLoginPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    });

    resolveLogin!({ id: 'u-1', email: 'a@b.com' });
  });

  it('shows error message from authService on failure', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid email or password'));

    renderLoginPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });

  it('calls onLogin prop with user on success', async () => {
    const onLogin = jest.fn();
    mockLogin.mockResolvedValueOnce({ id: 'u-1', email: 'a@b.com' });

    renderLoginPage(onLogin);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ id: 'u-1', email: 'a@b.com' });
    });
  });

  it('shows client-side validation error for bad email', async () => {
    renderLoginPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });
});
