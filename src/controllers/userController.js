import crypto from 'crypto';
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Listing from '../models/Listing.js';
import { validateVatWithVIES } from '../utils/vatHelper.js';
import slugify from 'slugify';
import mongoose from 'mongoose';
import {
  buildVersionedCacheKey,
  invalidateListingCaches,
  invalidateUserProfileCaches,
  getCache,
  parseCachedJson,
  setCache,
} from '../utils/cache.js';
import dns from 'dns/promises';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body;

    // ১. ডুপ্লিকেট ইউজার চেক
    let user = await User.findOne({ $or: [{ email }, { username }] });

    if (user && user.isEmailVerified) {
      return res.status(400).json({ message: 'User already exists and is verified.' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpire = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const hashedPassword = await bcrypt.hash(password, 10);

    if (user && !user.isEmailVerified) {
      user.firstName = firstName;
      user.lastName = lastName;
      user.username = username;
      user.password = hashedPassword;
      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpire = verificationExpire;
      await user.save();
    } else {
      const slug =
        slugify(`${firstName} ${lastName}`, { lower: true, strict: true }) +
        '-' +
        crypto.randomBytes(4).toString('hex');

      user = await User.create({
        slug,
        firstName,
        lastName,
        username,
        email,
        password: hashedPassword,
        profile: {},
        isEmailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpire: verificationExpire,
      });
    }

    // ২. ভেরিফিকেশন ইউআরএল
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    // ৩. Resend দিয়ে ইমেইল পাঠানো
    // ENV চেক করা যাতে API Key মিসিং থাকলে সার্ভার ক্রাশ না করে
    if (!process.env.RESEND_API_KEY) {
      console.error('Missing RESEND_API_KEY in Environment Variables');
      return res.status(500).json({ message: 'Email service configuration missing.' });
    }

    const { data, error } = await resend.emails.send({
      from: 'World Culture Marketplace <noreply@worldculturemarketplace.com>',
      to: [email],
      subject: 'Verify your email address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 15px;">
          <h2 style="color: #333;">Welcome, ${firstName}!</h2>
          <p>Please verify your email address by clicking the button below. This link expires in <strong>24 hours</strong>.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="padding:14px 30px; background:#F57C00; color:#fff; border-radius:10px; text-decoration:none; font-weight:bold; display:inline-block;">
              Verify Email
            </a>
          </div>
          <p style="color:#888; font-size:12px;">If you didn't register, please ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error('Resend Error:', error);
      return res.status(500).json({ message: 'Could not send verification email.' });
    }

    res.status(201).json({
      message: 'Registration link sent! Please check your email to verify your account.',
    });
  } catch (error) {
    console.error('System Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpire: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification link.' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpire = undefined;
    await user.save();

    res.status(200).json({ message: 'Email verified successfully! You can now log in.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({ message: 'Please verify your email before logging in.' });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({
        message: 'Your account has been blocked by admin. Please contact support.',
      });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const becomeCreator = async (req, res) => {
  try {
    const {
      displayName,
      businessName,
      category,
      bio,
      country,
      countryCode, // ISO কোড (FR, DE, etc.) - VAT এর জন্য জরুরি
      city,
      customerType, // 'individual' or 'business'
      vatNumber, // Optional
      language,
      websiteLink,
      socialLink,
    } = req.body;

    const currentUser = await User.findById(req.user._id);
    if (!currentUser) return res.status(404).json({ message: 'User not found' });

    // ১. ইমেজ হ্যান্ডলিং
    let profilePath = currentUser.profile?.profileImage || '';
    let coverPath = currentUser.profile?.coverImage || '';

    if (req.files) {
      if (req.files.profileImage?.[0]) profilePath = req.files.profileImage[0].path;
      if (req.files.coverImage?.[0]) coverPath = req.files.coverImage[0].path;
    }

    // ২. VAT Validation Logic (যদি বিজনেস হয় এবং ভ্যাট নাম্বার থাকে)
    let isVatValid = false;
    if (customerType === 'business' && vatNumber) {
      // VIES API বা অন্য কোনো ভ্যালিডেটর কল করুন
      isVatValid = await validateVatWithVIES(vatNumber);
    }

    // ৩. ডাটাবেস আপডেট
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'profile.displayName': displayName,
          'profile.businessName': businessName,
          'profile.category': category,
          'profile.bio': bio,
          'profile.country': country,
          'profile.countryCode': countryCode,
          'profile.city': city,
          'profile.customerType': customerType || 'individual',
          'profile.vatNumber': vatNumber || '',
          'profile.isVatValid': isVatValid,
          'profile.vatLastChecked': isVatValid ? new Date() : null,
          'profile.language': language,
          'profile.websiteLink': websiteLink,
          'profile.socialLink': socialLink,
          'profile.profileImage': profilePath,
          'profile.coverImage': coverPath,

          // রিকোয়েস্ট স্ট্যাটাস
          'creatorRequest.isApplied': true,
          'creatorRequest.appliedAt': new Date(),
          'creatorRequest.status': 'pending',
          'creatorRequest.rejectionReason': '',
        },
      },
      { returnDocument: 'after', runValidators: true }
    ).select('-password');

    await invalidateUserProfileCaches({
      id: updatedUser._id,
      username: updatedUser.username,
      slug: updatedUser.slug,
    });

    res.status(200).json({
      message: 'Creator application submitted successfully for review.',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Become Creator Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const logoutUser = (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
  res.status(200).json({ message: 'Logged out successfully' });
};

export const updateUserProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      displayName,
      bio,
      country,
      city,
      language,
      websiteLink,
      socialLink,
    } = req.body;

    const currentUser = await User.findById(req.user._id);

    let profilePath = currentUser.profile?.profileImage;
    let coverPath = currentUser.profile?.coverImage;

    if (req.files) {
      if (req.files['profileImage']) {
        profilePath = req.files['profileImage'][0].path;
      }
      if (req.files['coverImage']) {
        coverPath = req.files['coverImage'][0].path;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          firstName,
          lastName,
          'profile.displayName': displayName,
          'profile.bio': bio,
          'profile.country': country,
          'profile.city': city,
          'profile.language': language,
          'profile.websiteLink': websiteLink,
          'profile.socialLink': socialLink,
          'profile.profileImage': profilePath,
          'profile.coverImage': coverPath,
        },
      },
      { returnDocument: 'after' }
    ).select('-password');

    await invalidateUserProfileCaches({
      id: updatedUser._id,
      username: updatedUser.username,
      slug: updatedUser.slug,
    });

    res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Profile Update Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const updateCreatorProfile = async (req, res) => {
  try {
    if (req.user.role !== 'creator') {
      return res
        .status(403)
        .json({ message: 'Access denied. Only creators can update these fields.' });
    }

    const { displayName, bio, country, city, language, websiteLink, socialLink } = req.body;

    const updateFields = {
      'profile.displayName': displayName,
      'profile.bio': bio,
      'profile.country': country,
      'profile.city': city,
      'profile.language': language,
      'profile.websiteLink': websiteLink,
      'profile.socialLink': socialLink,
    };

    if (req.files) {
      if (req.files.profileImage) {
        updateFields['profile.profileImage'] = req.files.profileImage[0].path;
      }
      if (req.files.coverImage) {
        updateFields['profile.coverImage'] = req.files.coverImage[0].path;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateFields },
      { new: true }
    ).select('-password');

    await invalidateUserProfileCaches({
      id: user._id,
      username: user.username,
      slug: user.slug,
    });

    res.status(200).json({ message: 'Creator profile updated', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteUserAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const deletedListings = await Listing.find({ creatorId: userId }).select('_id slug').lean();
    await Listing.deleteMany({ creatorId: userId });

    await Promise.all([
      invalidateUserProfileCaches({
        id: user._id,
        username: user.username,
        slug: user.slug,
      }),
      ...deletedListings.map((listing) =>
        invalidateListingCaches({
          id: listing._id,
          slug: listing.slug,
          creatorId: userId,
        })
      ),
    ]);

    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.status(200).json({
      success: true,
      message: 'Account and all associated data have been permanently deleted.',
    });
  } catch (error) {
    console.error('Delete Account Error:', error);
    res.status(500).json({ message: 'Internal server error during account deletion' });
  }
};

export const getPublicProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const normalizedId = id.toLowerCase();
    const cacheKey = `user:profile:${normalizedId}`;
    const cachedProfile = parseCachedJson(await getCache(cacheKey));

    if (cachedProfile) {
      return res.status(200).json(cachedProfile);
    }

    let query;
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = {
        $or: [{ username: id.toLowerCase() }, { slug: id }],
      };
    }

    const user = await User.findOne(query)
      .select('-password -email -isAdmin -creatorRequest.rejectionReason')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User identity not found in node' });
    }

    const listingsCount = await Listing.countDocuments({
      creatorId: user._id,
      status: 'approved',
    });

    const responseData = {
      user,
      listingsCount,
    };

    await Promise.all([
      setCache(cacheKey, responseData, 3600),
      setCache(`user:profile:${user._id.toString().toLowerCase()}`, responseData, 3600),
      setCache(`user:profile:${user.username.toLowerCase()}`, responseData, 3600),
      user.slug ? setCache(`user:profile:${user.slug.toLowerCase()}`, responseData, 3600) : null,
    ]);

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Public Profile Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// ১০. Famous Creators List with Advanced Filtering, Sorting, and Pagination
export const getFamousCreators = async (req, res) => {
  try {
    const { limit = 10, offset = 0, sortBy = 'listings', search = '', country = '' } = req.query;
    const cacheKey = await buildVersionedCacheKey(
      'creators:famous',
      JSON.stringify({ limit, offset, sortBy, search, country })
    );
    const cachedData = parseCachedJson(await getCache(cacheKey));

    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);

    let userQuery = {
      role: 'creator',
      status: 'active',
    };

    // 🔎 Search filter
    if (search) {
      userQuery.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
      ];
    }

    // 🌍 Country filter
    if (country) {
      userQuery['profile.country'] = { $regex: country, $options: 'i' };
    }

    const aggregatePipeline = [
      { $match: userQuery },

      {
        $lookup: {
          from: 'listings',
          localField: '_id',
          foreignField: 'creatorId',
          as: 'allListings',
        },
      },

      {
        $project: {
          firstName: 1,
          lastName: 1,
          username: 1,
          profile: 1,

          totalListings: {
            $size: {
              $filter: {
                input: '$allListings',
                as: 'l',
                cond: { $eq: ['$$l.status', 'approved'] },
              },
            },
          },

          totalViews: {
            $sum: {
              $map: {
                input: '$allListings',
                as: 'l',
                in: {
                  $cond: [{ $eq: ['$$l.status', 'approved'] }, '$$l.views', 0],
                },
              },
            },
          },
        },
      },

      { $match: { totalListings: { $gt: 0 } } },
    ];

    // 🔥 Sorting
    const sortField = sortBy === 'views' ? { totalViews: -1 } : { totalListings: -1 };

    aggregatePipeline.push({ $sort: sortField });

    // ✅ Count pipeline (pagination total)
    const countPipeline = [...aggregatePipeline];

    // ✅ OFFSET-BASED PAGINATION
    aggregatePipeline.push({ $skip: parsedOffset }, { $limit: parsedLimit });

    const [creators, totalCountData] = await Promise.all([
      User.aggregate(aggregatePipeline),
      User.aggregate([...countPipeline, { $count: 'total' }]),
    ]);

    const totalCreators = totalCountData[0]?.total || 0;

    const responseData = {
      success: true,
      data: creators,
      pagination: {
        total: totalCreators,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < totalCreators,
      },
    };

    await setCache(cacheKey, responseData, 600);

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Famous Creators Tactical Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getTopCreatorsWithDropdown = async (req, res) => {
  try {
    const { search = '', country = '' } = req.query;
    const cacheKey = await buildVersionedCacheKey(
      'creators:top30',
      JSON.stringify({ search, country })
    );
    const cachedData = parseCachedJson(await getCache(cacheKey));

    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    let userQuery = {
      role: 'creator',
      status: 'active',
    };

    // 🔎 Search & Country filters
    if (search) {
      userQuery.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
      ];
    }
    if (country) {
      userQuery['profile.country'] = { $regex: country, $options: 'i' };
    }

    const aggregatePipeline = [
      { $match: userQuery },
      {
        $lookup: {
          from: 'listings',
          localField: '_id',
          foreignField: 'creatorId',
          as: 'allListings',
        },
      },
      {
        $project: {
          firstName: 1,
          lastName: 1,
          username: 1,
          profile: 1,
          // ১. টপ ৩০ নির্ধারণের জন্য spending power ক্যালকুলেশন (Boost + PPC)
          spendingPower: {
            $sum: [
              { $sum: '$allListings.promotion.boost.amountPaid' },
              { $sum: '$allListings.promotion.ppc.amountPaid' },
            ],
          },
          // ২. শুধুমাত্র এপ্রুভড লিস্টিং এর সংখ্যা
          approvedListingsCount: {
            $size: {
              $filter: {
                input: '$allListings',
                as: 'l',
                cond: { $eq: ['$$l.status', 'approved'] },
              },
            },
          },
        },
      },
      // যাদের অন্তত ১টি এপ্রুভড লিস্টিং আছে
      { $match: { approvedListingsCount: { $gt: 0 } } },
      // ৩. Spending Power অনুযায়ী সর্টিং (বেশি টাকা খরচ করা ক্রিয়েটররা উপরে থাকবে)
      { $sort: { spendingPower: -1, approvedListingsCount: -1 } },
    ];

    const allCreators = await User.aggregate(aggregatePipeline);

    // ৪. লজিক: প্রথম ৩০ জন "Top 30", বাকিরা "Dropdown List"
    const top30Creators = allCreators.slice(0, 30);
    const restCreators = allCreators.slice(30).map((c) => ({
      _id: c._id,
      fullName: `${c.firstName} ${c.lastName}`,
      username: c.username,
    }));

    const responseData = {
      success: true,
      message: 'Our Top 30 Creators',
      data: {
        top30: top30Creators,
        dropdownList: restCreators, // বাকিরা ড্রপডাউনের জন্য
        totalCount: allCreators.length,
      },
    };

    await setCache(cacheKey, responseData, 600);

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Top Creators Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getModerationReasons = async (req, res) => {
  try {
    const reasonCodes = User.schema.path('creatorRequest.rejectionReason').enumValues;

    // empty string ফিল্টার করে ফ্রন্টএন্ডে ক্লিন ডাটা পাঠানো
    const filteredReasons = reasonCodes.filter((r) => r !== '');

    res.status(200).json({
      success: true,
      reasons: filteredReasons,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found with this email' });
    }

    // ১. রিসেট টোকেন তৈরি
    const resetToken = crypto.randomBytes(20).toString('hex');

    // ২. টোকেন হ্যাশ করে ডেটাবেজে সেভ করা
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // ৩০ মিনিট মেয়াদ

    await user.save();

    // ক্যাশ ইনভ্যালিডেশন (যদি আপনার সিস্টেমে থাকে)
    if (typeof invalidateUserProfileCaches === 'function') {
      await invalidateUserProfileCaches({
        id: user._id,
        username: user.username,
        slug: user.slug,
      });
    }

    // ৩. রিসেট ইউআরএল তৈরি
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // ৪. Resend দিয়ে ইমেইল পাঠানো
    if (!process.env.RESEND_API_KEY) {
      console.error('Missing RESEND_API_KEY in Environment Variables');
      return res.status(500).json({ message: 'Email service not configured.' });
    }

    const { data, error } = await resend.emails.send({
      from: 'WCM Support <support@worldculturemarketplace.com>', // ডোমেইন ভেরিফাই করলে support@yourdomain.com দিতে পারবেন
      to: [user.email],
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #eee; padding: 25px; border-radius: 15px;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p style="color: #555;">You requested a password reset for your World Culture Marketplace account. Please click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #F57C00; color: white; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #888; font-size: 14px;">This link will expire in <strong>30 minutes</strong>.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email or contact support if you have concerns.</p>
        </div>
      `,
    });

    if (error) {
      console.error('Resend Error:', error);
      return res.status(500).json({ success: false, message: 'Could not send reset email' });
    }

    res.status(200).json({ success: true, message: 'Password reset email sent successfully' });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(req.body.password, salt);

    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();
    await invalidateUserProfileCaches({
      id: user._id,
      username: user.username,
      slug: user.slug,
    });

    res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
