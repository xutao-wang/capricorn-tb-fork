// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// src/components/Header/Header.js
import React from 'react';
import UserMenu from './UserMenu';

const Header = ({ user, firstName, handleLogin, handleLogout, showUserMenu, setShowUserMenu, isAuthenticated }) => {


  const isAnonymous = user && user.isAnonymous;
  const showLoginButton = !isAuthenticated || isAnonymous;

  return (
    <div className="p-4 flex justify-end items-center">
      <div className="flex items-center">
        {showLoginButton ? (
          <div className="relative z-20">
            <button
              onClick={() => {

                handleLogin();
              }}
              className="mr-4 px-4 py-2 text-white hover:text-blue-100 transition-colors"
            >
              Login
            </button>
          </div>
        ) : (
          <UserMenu
            user={user}
            firstName={firstName}
            handleLogout={handleLogout}
            showUserMenu={showUserMenu}
            setShowUserMenu={setShowUserMenu}
            isAuthenticated={isAuthenticated}
          />
        )}
      </div>
    </div>
  );
};

export default Header;
