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

// src/components/Header/UserMenu.js
import React from 'react';

const UserMenu = ({ user, firstName, handleLogout, showUserMenu, setShowUserMenu, isAuthenticated }) => {


  if (!isAuthenticated) {
    return null;
  }

  const toggleUserMenu = () => {

    setShowUserMenu(!showUserMenu);

  };

  return (
    <div className="relative flex items-center">
      <div
        className="relative z-20 cursor-pointer"
        onClick={toggleUserMenu}
      >
        {user?.photoURL ? (
          <img
            src={user.photoURL}
            alt="Profile"
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-transparent text-white flex items-center justify-center">
            {(firstName || user?.displayName || 'U')[0].toUpperCase()}
          </div>
        )}
      </div>
      {showUserMenu && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-30">
          <div className="px-4 py-2 text-sm text-[#1e3a8a] font-semibold">Welcome, {firstName || user?.displayName}</div>
          <div className="px-4 py-2 text-sm text-gray-600">{user?.email}</div>
          <button
            onClick={() => {

              handleLogout();
              setShowUserMenu(false);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-[#1e3a8a] hover:bg-blue-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
