import AuditLog from '../models/AuditLog.js';

export const getCreatorAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find({ user: req.user._id })
      .populate('targetId')
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // সার্চ কুয়েরি তৈরি (Action বা TargetType এ সার্চ করা যাবে)
    let query = {};
    if (search) {
      query = {
        $or: [
          { action: { $regex: search, $options: 'i' } },
          { targetType: { $regex: search, $options: 'i' } },
          { ipAddress: { $regex: search, $options: 'i' } },
        ],
      };
    }

    // লগের সাথে ইউজার ডাটা পপুলেট করা এবং ইউজারের নাম দিয়ে সার্চ করা
    const logs = await AuditLog.find(query)
      .populate({
        path: 'user',
        select: 'name email role',
        match: search ? { name: { $regex: search, $options: 'i' } } : {},
      })
      .populate('targetId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await AuditLog.countDocuments(query);

    res.status(200).json({
      success: true,
      logs: logs.filter((log) => log.user !== null || !search),
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
