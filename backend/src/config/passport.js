const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const { ObjectId } = require('mongodb');

function setupPassport(userCollection) {
  // ========== Google OAuth Strategy ==========
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Tìm hoặc tạo user
          let user = await userCollection.findOne({
            'oauth_providers.provider': 'google',
            'oauth_providers.provider_id': profile.id
          });

          if (!user) {
            // Sinh user_id tuần tự kiểu USRXXXXX
            const lastUser = await userCollection.findOne({}, { sort: { user_id: -1 } });
            let nextNum = 1;
            if (lastUser && lastUser.user_id) {
              const match = lastUser.user_id.match(/USR(\d+)/);
              if (match) {
                nextNum = parseInt(match[1], 10) + 1;
              }
            }
            const user_id = `USR${String(nextNum).padStart(5, '0')}`;

            // Nếu user mới → tạo
            const newUser = {
              user_id,
              password_hash: null, // OAuth users không có password
              oauth_providers: [
                {
                  provider: 'google',
                  provider_id: profile.id
                }
              ],
              profile_name: profile.displayName,
              role: 'customer',
              status: 'active',
              addresses: [],
              payment_methods: [],
              saved_products: [],
              saved_recipes: [],
              saved_posts: [],
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const email = profile.emails?.[0]?.value;
            if (email) newUser.email = email;
            const avatar_url = profile.photos?.[0]?.value;
            if (avatar_url) newUser.avatar_url = avatar_url;

            const result = await userCollection.insertOne(newUser);
            user = { ...newUser, _id: result.insertedId };
          }

          done(null, user);
        } catch (error) {
          done(error);
        }
      }
    )
  );

  // ========== Facebook OAuth Strategy ==========
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL,
        profileFields: ['id', 'displayName', 'emails', 'photos']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          let user = await userCollection.findOne({
            'oauth_providers.provider': 'facebook',
            'oauth_providers.provider_id': profile.id
          });

          if (!user) {
            // Sinh user_id tuần tự kiểu USRXXXXX
            const lastUser = await userCollection.findOne({}, { sort: { user_id: -1 } });
            let nextNum = 1;
            if (lastUser && lastUser.user_id) {
              const match = lastUser.user_id.match(/USR(\d+)/);
              if (match) {
                nextNum = parseInt(match[1], 10) + 1;
              }
            }
            const user_id = `USR${String(nextNum).padStart(5, '0')}`;

            const newUser = {
              user_id,
              password_hash: null,
              oauth_providers: [
                {
                  provider: 'facebook',
                  provider_id: profile.id
                }
              ],
              profile_name: profile.displayName,
              role: 'customer',
              status: 'active',
              addresses: [],
              payment_methods: [],
              saved_products: [],
              saved_recipes: [],
              saved_posts: [],
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const email = profile.emails?.[0]?.value;
            if (email) newUser.email = email;
            const avatar_url = profile.photos?.[0]?.value;
            if (avatar_url) newUser.avatar_url = avatar_url;

            const result = await userCollection.insertOne(newUser);
            user = { ...newUser, _id: result.insertedId };
          }

          done(null, user);
        } catch (error) {
          done(error);
        }
      }
    )
  );

  // ========== Serialize/Deserialize ==========
  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await userCollection.findOne({ _id: ObjectId(id) });
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}

module.exports = setupPassport;