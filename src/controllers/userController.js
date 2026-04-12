import crypto from 'crypto';
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Listing from '../models/Listing.js';
import { validateVatWithVIES } from '../utils/vatHelper.js';
import slugify from 'slugify';
import mongoose from 'mongoose';

// ১. Register
export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body;
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const slug =
      slugify(`${firstName} ${lastName}`, { lower: true, strict: true }) +
      '-' +
      crypto.randomBytes(4).toString('hex');

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      slug,
      firstName,
      lastName,
      username,
      email,
      password: hashedPassword,
      profile: {},
    });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ২. Login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
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

// ৩. Become Creator
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
      { new: true, runValidators: true }
    ).select('-password');

    res.status(200).json({
      message: 'Creator application submitted successfully for review.',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Become Creator Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// ৪. Profile View
export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ৫. Logout
export const logoutUser = (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
  res.status(200).json({ message: 'Logged out successfully' });
};

// ৬. (user update)
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

    res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Profile Update Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// ৭. (creator update)
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

    res.status(200).json({ message: 'Creator profile updated', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ৮. Delete Account
export const deleteUserAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    await Listing.deleteMany({ creatorId: userId });

    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

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

// ৯. Public Profile View
// export const getPublicProfile = async (req, res) => {
//   try {
//     const user = await User.findById(req.params.id)
//       .select('-password -email -isAdmin -creatorRequest.rejectionReason')
//       .lean();

//     if (!user) {
//       return res.status(404).json({ message: 'User identity not found in node' });
//     }

//     const listingsCount = await Listing.countDocuments({
//       creatorId: req.params.id,
//       status: 'approved',
//     });

//     res.status(200).json({
//       user,
//       listingsCount,
//     });
//   } catch (error) {
//     console.error('Public Profile Error:', error);
//     res.status(500).json({ message: 'Internal Server Error' });
//   }
// };

export const getPublicProfile = async (req, res) => {
  try {
    const { id } = req.params;

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

    res.status(200).json({
      user,
      listingsCount,
    });
  } catch (error) {
    console.error('Public Profile Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// ১০. Famous Creators List with Advanced Filtering, Sorting, and Pagination
export const getFamousCreators = async (req, res) => {
  try {
    const { limit = 10, offset = 0, sortBy = 'listings', search = '', country = '' } = req.query;

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

    res.status(200).json({
      success: true,
      data: creators,
      pagination: {
        total: totalCreators,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < totalCreators,
      },
    });
  } catch (error) {
    console.error('Famous Creators Tactical Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getTopCreatorsWithDropdown = async (req, res) => {
  try {
    const { search = '', country = '' } = req.query;

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

    res.status(200).json({
      success: true,
      message: 'Our Top 30 Creators',
      data: {
        top30: top30Creators,
        dropdownList: restCreators, // বাকিরা ড্রপডাউনের জন্য
        totalCount: allCreators.length,
      },
    });
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
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found with this email' });
    }

    const resetToken = crypto.randomBytes(20).toString('hex');

    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 30 * 60 * 1000;

    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"WCM Support" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <h3>Password Reset Request</h3>
        <p>You requested a password reset. Please click the link below to reset your password:</p>
        <a href="${resetUrl}" clicktracking=off>${resetUrl}</a>
        <p>This link will expire in 30 minutes.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
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

    res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
