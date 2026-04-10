import Visitor from '../models/Visitor.js';
import axios from 'axios';

export const trackVisitor = async (req, res) => {
  const { visitorId, device, os } = req.body;

  if (req.user) {
    return res.status(200).json({ success: true, message: 'Logged in user, skipping count' });
  }

  try {
    const existingVisitor = await Visitor.findOne({ visitorId });

    if (existingVisitor) {
      return res.status(200).json({ success: true, message: 'Already tracked' });
    }

    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip.includes('::ffff:')) {
      ip = ip.split(':').reverse()[0];
    }

    let country = 'Unknown';
    let city = 'Unknown';

    try {
      const ipInfo = await axios.get(`http://ip-api.com/json/${ip}`);
      if (ipInfo.data.status === 'success') {
        country = ipInfo.data.country;
        city = ipInfo.data.city;
      }
    } catch (err) {
      console.error('IP API Error:', err.message);
    }

    await Visitor.create({
      visitorId,
      ip,
      device,
      os,
      country,
      city,
    });

    return res.status(201).json({ success: true, message: 'New unique visitor tracked' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
