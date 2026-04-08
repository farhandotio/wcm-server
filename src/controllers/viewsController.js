import Visitor from '../models/Visitor.js';
import axios from 'axios';

export const trackVisitor = async (req, res) => {
  const { visitorId, device, os } = req.body;

  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip.includes('::ffff:')) {
    ip = ip.split(':').reverse()[0]; 
  }

  try {
    let visitor = await Visitor.findOne({ visitorId });

    if (visitor) {
      visitor.visitCount += 1;
      visitor.lastVisited = Date.now();
      await visitor.save();
      return res.status(200).json({ success: true, message: 'Existing visitor updated' });
    } else {
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

      return res.status(201).json({ success: true, message: 'New visitor tracked' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
