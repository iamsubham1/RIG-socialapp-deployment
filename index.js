const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const uuid = require("uuid");
const mongoose = require("mongoose");
const { ObjectId } = require("mongodb");
const multer = require("multer");
const { exec } = require("child_process");
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");
const paypal = require("paypal-rest-sdk");
const connectToMongo = require('./db');
const port = process.env.PORT;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const verifyUser = require('./middleware/verifyuser')
const bcrypt = require("bcryptjs");
const ffmpeg = require('fluent-ffmpeg');
const cookieParser = require("cookie-parser");
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');

//importing schemas

const Video = require('./models/videoSchema');
const UserInfo = require('./models/userSchema');
const Message = require('./models/messageSchema');
const { userInfo } = require("os");

//acquire environment variables
require('dotenv').config({ path: '.env' });
const mongoURI = process.env.MONGODB_URI;

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);

});

const upload = multer({ dest: 'temp' });

//cookie parser
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.cloud_name,
  api_key: process.env.api_key,
  api_secret: process.env.api_secret,
});






const startServer = async () => {
  // Helper functions to get additional information
  async function getAuthorName(authorId) {
    const login = await UserInfo.findOne({ authorId });
    console.log(login);
    return login ? login.fancyId : "Unknown";
  }
  async function getProfilePic(authorId) {
    const person = await UserInfo.findById({ _id: authorId });
    return person ? person.profilePic : null;
  }

  async function isVideoLikedByUser(videoId, email) {
    console.log('Checking liked status for videoId:', videoId, 'and email:', email);
    const video = await Video.findById(videoId);
    console.log('Video:', video);
    return video.likes.includes(email);
  }

  async function isVideoSavedByUser(videoId, email) {
    const video = await Video.findById(videoId);
    return video.saved.includes(email);
  }
  // Serve the static files

  app.use(express.static("public"));
  app.use(cors());
  app.use(express.json());


  // Set up MongoDB connection
  const connectToMongo = async () => {

    try {
      await mongoose.connect(mongoURI);
      // console.log("Connected to MongoDB successfully");
    }
    catch (error) {
      console.log(error);
      process.exit();
    }
  };
  connectToMongo();

  app.get('/', (req, res) => {
    res.send("welcome to RIG Socialmedia-app")
  })

  //tested

  app.post("/signup", [
    // Validation middleware
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ], async (req, res) => {


    try {
      const { name, email, password } = req.body;

      // Check if the user already exists
      const existingUser = await UserInfo.findOne({ email });

      if (!existingUser) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: [{ msg: errors.errors[0].msg }] });

        }
        // Create a new user
        const hashPassword = await bcrypt.hash(password, 13);
        const fancyId = email.split("@")[0];
        const newUser = new UserInfo({ name, email, password: hashPassword, fancyId });

        // Save the new user to the database
        await newUser.save();

        const userData = await UserInfo.findOne({ email });

        res.status(200).json({ message: "User created successfully", _ID: userData["_id"] });
      } else {
        res.status(409).json({ message: "User already exists" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error creating user" });
    }
  });

  app.post("/login", [
    body('email', 'Enter a valid email').isEmail(),
    body('password', 'Password cannot be empty').exists(),
  ],
    async (req, res) => {
      try {
        const { email, password } = req.body;
        // Find a document where email and password match
        const user = await UserInfo.findOne({ email });
        if (user) {
          const passwordCompare = bcrypt.compare(password, user.password);
          if (passwordCompare) {
            const token = jwt.sign({ email: user.email, name: user.name }, process.env.JWT_SIGNATURE);

            return res.status(200).json({ msg: "Login successful", token: token, userData: user })
          }
          return res.status(401).json({ msg: "Incorrect credentials" });
        }
        return res.status(401).json({ msg: "User not found" });
      } catch (error) {
        res.status(500).json({ message: "Error retrieving login", error });
      }
    });

  app.post('/upload', verifyUser, upload.single('video'), async (req, res) => {
    try {
      const { description, email, author } = req.body;
      const inputUrl = req.file.path;

      const thumbnailPath = `./images/thumbnail.png`;

      // generate thumbnail
      ffmpeg(inputUrl)
        .screenshots({
          count: 1,
          filename: 'thumbnail.png',
          size: '320x240',
          folder: './images',
        })
        .on('end', () => {
          console.log('Thumbnail generated successfully!');

          // Upload thumbnail
          cloudinary.uploader.upload(thumbnailPath, { folder: 'thumbnails' }, async (error, thumbnailResult) => {
            if (error) {
              console.error(`Error uploading thumbnail to Cloudinary: ${error}`);
              res.status(500).send('Error uploading thumbnail to Cloudinary');
              return;
            }

            // Upload to Cloudinary
            cloudinary.uploader.upload(inputUrl, { resource_type: 'video' }, async (error, result) => {
              if (error) {
                console.error(`Error uploading to Cloudinary: ${error}`);
                res.status(500).send('Error uploading to Cloudinary');
                return;
              }

              // Create a new video instance
              const newVideo = new Video({
                email,
                description,
                author,
                videoUrl: result.secure_url,
                thumbnailUrl: thumbnailResult.secure_url,
              });

              // Save the video to the database
              const savedVideo = await newVideo.save();

              // Delete temporary videofile
              fs.unlink(inputUrl, (err) => {
                if (err) {
                  console.error(`Error deleting file: ${err}`);
                }
                console.log('Temporary file deleted successfully');
              });

              // Delete temporary thumbnailfile
              fs.unlink(thumbnailPath, (err) => {
                if (err) {
                  console.error(`Error deleting thumbnail file: ${err}`);
                }
                console.log('Temporary thumbnail file deleted successfully');
              });
              // Update the corresponding user's posts array in the UserInfo schema
              await UserInfo.findOneAndUpdate(
                { email },
                { $push: { posts: savedVideo._id } }
              );
              res.status(201).json({ message: 'Video uploaded successfully' });
            });
          });
        })
        .on('error', (err) => {
          console.error('Error generating thumbnail:', err);
          res.status(500).json({ message: 'Error generating thumbnail' });
        });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error uploading video' });
    }
  });

  app.get('/uploadedcontent', async (req, res) => {
    try {
      const { email } = req.body;
      console.log(req.body);

      // Find the user by email
      console.log('Email to query:', email);
      const user = await UserInfo.findOne({ email });
      console.log('User:', user);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      // Find videos for the user
      const videos = await Video.find({ email }).sort({ createdAt: -1 });
      console.log('Videos:', videos);
      if (!videos) {
        return res.status(200).json({ message: 'No videos found for the user' });
      }

      const reelsWithInfo = videos.map((video) => {
        const creator = user.name;


        return {
          ...video.toObject(),
          creator,

        };
      });

      res.status(200).json(reelsWithInfo);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/reels', async (req, res) => {
    try {
      const { email } = req.body;
      const allVideos = await Video.find().sort({ createdAt: -1 });

      if (!allVideos || allVideos.length === 0) {
        return res.status(200).json({ message: 'No videos found' });
      }

      // Create an array of video objects with additional information
      const videosWithInfo = await Promise.all(
        allVideos.map(async (video) => {
          // Get author's name using a helper function getAuthorName
          const authorName = await getAuthorName(video.author);

          // Get liked status using isVideoLikedByUser helper function
          const likedStatus = await isVideoLikedByUser(video._id, email);
          // console.log(`Video ID: ${video._id}, User Email: ${email}, Liked Status: ${likedStatus}`);

          // Get the number of likes, comments, and saved status using video properties
          const likesCount = video.likes.length;
          const commentsCount = video.comments.length;
          const savedStatus = await isVideoSavedByUser(video._id, email);
          const savedByCount = video.saved.length;

          // Return an object with video details and additional information
          return {
            ...video.toObject(),
            authorName,
            likedStatus,
            likesCount,
            commentsCount,
            savedStatus,
            savedByCount,
          };
        })
      );

      // Respond with the array of videos and additional information
      res.status(200).json(videosWithInfo);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });


  app.post("/like", async (req, res) => {
    try {
      const { videoId, email, likedStatus } = req.body;

      // Check if the video exists
      const video = await Video.findById(videoId);
      if (!video) {
        console.error('Video not found');
        return res.status(404).json({ message: "Video not found" });
      }

      // Check if the user has already liked the video
      const userAlreadyLiked = video.likes.includes(email);

      // Perform like/dislike action based on likedStatus
      if (likedStatus && !userAlreadyLiked) {
        console.log('Adding like for user:', email);
        video.likes.push(email);
      } else if (!likedStatus && userAlreadyLiked) {
        console.log('Removing like for user:', email);
        video.likes = video.likes.filter(id => id !== email);
      }

      // Save the updated video
      await video.save();

      console.log('Video liked/disliked successfully');
      res.status(200).json({ message: "Video liked/disliked successfully" });
    } catch (error) {
      console.error('Error liking/disliking video:', error);
      res.status(500).json({ message: "Error liking/disliking video" });
    }
  });


  app.post("/likeComment", async (req, res) => {
    try {
      const { videoId, commentId, email, likedStatus } = req.body;
      if (likedStatus) {
        await Video.updateOne(
          { _id: videoId, "comments._id": new ObjectId(commentId) },
          { $pull: { "comments.$.likes": email } }
        );
      } else {
        await Video.updateOne(
          { _id: videoId, "comments._id": new ObjectId(commentId) },
          { $push: { "comments.$.likes": email } }
        );
      }
      res.status(200).json({ message: "Comment liked/disliked successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error liking/disliking comment" });
    }
  });

  app.post("/getComments", async (req, res) => {
    try {
      const { videoId, email } = req.body;
      const video = await Video.findById(videoId);
      const comments = video.comments;
      const commentsWithInfo = await Promise.all(
        comments.map(async (comment) => {
          const authorName = await getAuthorName(comment.author);
          const profilePic = await getProfilePic(comment.author);
          const likedStatus = await comment.likes.includes(email);
          const likesCount = comment.likes.length;
          return {
            ...comment,
            authorName,
            profilePic,
            likedStatus,
            likesCount,
          };
        })
      );
      res.status(200).json(commentsWithInfo);
    } catch (error) {
      res.status(500).json({ message: "Error retrieving comments" });
    }
  });

  app.post("/postComment", async (req, res) => {
    try {
      const { videoId, author, comment } = req.body;
      const id = new ObjectId();
      await Video.updateOne(
        { _id: videoId },
        { $push: { comments: { _id: id, author, comment, likes: [] } } }
      );
      res.status(200).send("commented successfully");
    } catch (error) {
      res.status(500).json({ message: "Error posting comment" });
    }
  });

  app.post("/deletecomment", async (req, res) => {
    try {
      const { videoId, commentId } = req.body;

      // Check if the video exists
      const video = await Video.findById(videoId);
      if (!video) {
        return res.status(404).json({ message: "Video not found" });
      }

      // Find the index of the comment in the comments array
      const commentIndex = video.comments.findIndex(comment => comment._id.toString() === commentId);

      // Check if the comment exists
      if (commentIndex === -1) {
        return res.status(404).json({ message: "Comment not found" });
      }

      // Remove the comment from the comments array
      video.comments.splice(commentIndex, 1);

      // Save the updated video
      await video.save();

      res.status(200).json({ message: "Comment deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error deleting comment" });
    }
  });

  app.post("/save", async (req, res) => {
    try {
      const { videoId, userId, savedStatus } = req.body;

      if (savedStatus) {
        // console.log(`Removing save for video ID ${videoId} and user ${userId}`);
        await Video.updateOne({ _id: videoId }, { $pull: { saved: userId } });
        await UserInfo.updateOne({ _id: userId }, { $pull: { saved: videoId } });
      } else {
        // console.log(`Adding save for video ID ${videoId} and user ${userId}`);
        await Video.updateOne({ _id: videoId }, { $push: { saved: userId } });
        await UserInfo.updateOne({ _id: userId }, { $push: { saved: videoId } });
      }

      // console.log("Video saved/unsaved successfully");
      res.status(200).json({ message: "Video saved/unsaved successfully", savedStatus: !savedStatus });

    } catch (error) {
      // console.error("Error saving/unsaving video:", error);
      res.status(500).json({ message: "Error saving/unsaving video" });
    }
  });



  //not tested 
  app.post("/getPostsAndSaved", async (req, res) => {
    try {
      const { email, reqId } = req.body;
      const Info = await UserInfo.findOne({ _id: email });
      const posts = Info.posts;
      const saved = Info.saved;
      const followers = Info.followers;
      const following = Info.following;

      const postsInfo = await Promise.all(
        posts.map(async (post) => {
          const video = await Video.findById(post);
          return video;
        })
      );

      const savedInfo = await Promise.all(
        saved.map(async (save) => {
          const video = await Video.findById(save);
          return video;
        })
      );

      const followersInfo = await Promise.all(
        followers.map(async (follower) => {
          const user = await UserInfo.findById(follower);
          return {
            followerId: follower,
            followerName: user.fancyId,
            followerPic: user.profilePic,
            following: user.followers.includes(reqId),
          };
        })
      );

      const followingInfo = await Promise.all(
        following.map(async (follow) => {
          const user = await UserInfo.findById(follow);
          return {
            followingId: follow,
            followingName: user.fancyId,
            followingPic: user.profilePic,
            following: user.followers.includes(reqId),
          };
        })
      );

      res.status(200).json({ postsInfo, savedInfo, followersInfo, followingInfo });
    } catch (error) {
      res.status(500).json({ message: "Error retriving Last chat & info" });
    }
  });

  app.post("/message", async (req, res) => {
    try {
      const { from, to, message } = req.body;
      const newMessage = new Message({ from, to, message });
      await newMessage.save();
      res.status(200).json({ message: "Message sent successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error sending message" });
    }
  });

  app.post("/retriveMessage", async (req, res) => {
    try {
      const { from, to } = req.body;
      const messages = await Message.find({
        $or: [
          { from: from, to: to },
          { from: to, to: from },
        ],
      });
      await Message.updateMany(
        {
          from: to,
          to: from,
        },
        {
          seen: true,
        }
      );
      // console.log(messages);
      res.status(200).json(messages);
    } catch (error) {
      res.status(500).json({ message: "Error retriving message" });
    }
  });

  app.post("/usersAndUnseenChatsAndLastMessage", async (req, res) => {
    try {
      const { email } = req.body;
      const pipeline = [
        {
          $match: {
            $or: [{ to: email }, { from: email }],
          },
        },
        {
          $sort: {
            _id: -1,
          },
        },
        {
          $group: {
            _id: {
              $cond: [{ $eq: ["$from", email] }, "$to", "$from"],
            },
            unseenCount: {
              $sum: {
                $cond: [{ $eq: ["$to", email] }, { $cond: ["$seen", 0, 1] }, 0],
              },
            },
            lastMessage: {
              $first: "$message",
            },
          },
        },
      ];

      const chattedUsers = await Message.aggregate(pipeline);

      // Get an array of unique user IDs from the chattedUsers result
      const emails = chattedUsers.map((user) => user._id);

      // Fetch the corresponding user details from the UserInfo collection
      const userNames = await UserInfo.find({ _id: { $in: emails } }, "name");

      // Create a map of email to userName for faster lookup
      const userNameMap = new Map();
      userNames.forEach((user) =>
        userNameMap.set(user._id.toString(), user.name)
      );

      // Merge the userName into the chattedUsers result
      const chattedUsersWithNames = chattedUsers.map((user) => {
        const person = UserInfo.findOne({ _id: user._id });
        return {
          _id: user._id,
          name: userNameMap.get(user._id.toString()) || "Deleted User",
          profilePic: person.profilePic,
          unseenCount: user.unseenCount,
          lastMessage: user.lastMessage,
        };
      });

      // console.log(chattedUsersWithNames);
      res.status(200).json(chattedUsersWithNames);
    } catch (error) {
      res.status(500).json({ message: "Error retriving Last chat & info" });
    }
  });


  app.post("/getTokens", async (req, res) => {
    try {
      const { _id } = req.body;
      const getToken = await UserInfo.findOne({ _id });
      if (getToken) {
        res.status(200).json(getToken["tokens"]);
      } else {
        res.status(404).json({ message: "Tokens not found" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error retreiving Tokens" });
    }
  });

  app.post("/updateTokens", async (req, res) => {
    try {
      const { _id, tokens } = req.body;
      const updateToken = await UserInfo.updateOne({ _id }, { $inc: { tokens } });
      if (updateToken) {
        res.status(200).json({ message: "Tokens updated successfully" });
      } else {
        res.status(404).json({ message: "Tokens not updated" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error updating Tokens" });
    }
  });

  app.post("/storeInterests", async (req, res) => {
    try {
      const { _id, interests } = req.body;
      const addInterests = await UserInfo.updateOne({ _id }, { interests });
      if (addInterests) {
        res.status(200).json({ message: "Interests updated successfully" });
      } else {
        res.status(404).json({ message: "Interests not updated" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error updating Interests" });
    }
  });

  app.post("/getInterests", async (req, res) => {
    try {
      const { _id } = req.body;
      const getInterests = await UserInfo.findOne({ _id });
      if (getInterests) {
        res.status(200).json(getInterests["interests"]);
      } else {
        res.status(404).json({ message: "Interests not found" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error retreiving Interests" });
    }
  });
  app.use("/temp", express.static(path.join(__dirname, "temp")));





  //not tested yet
  app.post("/updateName", async (req, res) => {
    try {
      const { _id, name } = req.body;
      await UserInfo.updateOne({ _id }, { name });
      res.status(200).json({ message: "Name updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating Name" });
    }
  });

  app.post("/updateFancyId", async (req, res) => {
    try {
      const { _id, fancyId } = req.body;
      await UserInfo.updateOne({ _id }, { fancyId });
      res.status(200).json({ message: "FancyId updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating FancyId" });
    }
  });

  app.post("/updateEmail", async (req, res) => {
    try {
      const { _id, email } = req.body;
      await UserInfo.updateOne({ _id }, { email });
      res.status(200).json({ message: "Email updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating Email" });
    }
  });

  app.post("/updateSocial", async (req, res) => {
    try {
      const { _id, socialId } = req.body;
      await UserInfo.updateOne({ _id }, { socialId });
      res.status(200).json({ message: "Email updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating Email" });
    }
  });

  app.post("/getAllUsers", async (req, res) => {
    try {
      const { _id } = req.body;
      const users = await UserInfo.find({ _id: { $ne: _id } });
      const updatedUsers = users.map((user) => ({
        ...user._doc,
        following: user.followers.includes(_id),
      }));
      res.status(200).json(updatedUsers);
    } catch (error) {
      res.status(500).json({ message: "Error getting all users" });
    }
  });

  app.post("/getUserProfile", async (req, res) => {
    try {
      const { _id, reqId } = req.body;
      const user = await UserInfo.find({ _id });
      const updatedUser = {
        ...user[0]._doc,
        following: user[0].followers.includes(reqId),
      };
      res.status(200).json(updatedUser);
    } catch (error) {
      res.status(500).json({ message: "Error getting all users" });
    }
  });

  app.post("/follow", async (req, res) => {
    try {
      const { _id, reqId, followStatus } = req.body;
      if (followStatus) {
        await UserInfo.updateOne({ _id }, { $pull: { followers: reqId } });
        await UserInfo.updateOne({ _id: reqId }, { $pull: { following: _id } });
      } else {
        await UserInfo.updateOne({ _id }, { $push: { followers: reqId } });
        await UserInfo.updateOne({ _id: reqId }, { $push: { following: _id } });
      }
      res.status(200).json({ message: "Person followed/unfollowed successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error followed/unfollowed Person" });
    }


  });


  // forgotPassword
  app.post("/verify-email", async (req, res) => {
    const { email } = req.body;
    const existingUser = await UserInfo.findOne({ email });
    if (existingUser) {
      res.status(200).json({ message: true });
      return;
    }
    res.status(404).json({ message: false });
  });

  app.post("/change-password", async (req, res) => {
    try {
      const { email, password } = req.body;
      const updatePassword = await UserInfo.updateOne({ email }, { password });
      if (updatePassword) {
        res.status(200).json({ message: "Password changed successfully" });
      } else {
        res.status(404).json({ message: "Password not changed" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error changing Password" });
    }
  });

  // Create a transporter using Gmail SMTP configuration
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.APP_PASSWORD,
    },
  });

  // Handle POST request to verify email and send OTP
  app.post("/send-email", (req, res) => {
    const { email } = req.body;

    // Generate OTP
    const otp = otpGenerator.generate(4, {
      digits: true,
      alphabets: false,
      upperCase: false,
      specialChars: false,
    });

    // Compose the email message
    const mailOptions = {
      from: `NetTeam Support <${process.env.EMAIL}>`,
      to: email,
      subject: "Email Verification",
      text: `Your OTP is: ${otp}`,
    };

    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log("Error:", error);
        res
          .status(500)
          .json({ error: "An error occurred while sending the email" });
      } else {
        console.log("Email sent:", info.response);
        res.status(200).json(otp);
      }
    });
  });
  // forgot password


  //messages-start

  function matchSockets(socket) {
    if (availableUsers.size < 2) {
      socket.emit("chatError", "Waiting for another user to join...");
      return;
    }

    const myInterests = availableUsers.get(socket.id);

    // Remove the current user from the available users map
    availableUsers.delete(socket.id);

    // Find a matching user
    const match = [...availableUsers.entries()].find(([_, interests]) => {
      return interests.some((interest) => myInterests.includes(interest));
    });

    if (!match) {
      // No user with similar interests found, recursively call matchSockets again
      matchSockets(socket);
      return;
    }

    const [otherSocketId, otherUserInterests] = match;

    // Remove the selected user from the available users map
    availableUsers.delete(otherSocketId);

    // Create a chat room or session
    const roomId = uuid.v4();

    // Store the room ID in the sockets' custom properties for later use
    socket.data.roomId = roomId;
    const otherSocket = io.sockets.sockets.get(otherSocketId);
    otherSocket.data.roomId = roomId;

    socket.join(roomId);
    otherSocket.join(roomId);

    // Notify the users about the match and the room ID
    socket.emit("chatMatched", {
      roomId: roomId,
      to: otherSocketId,
    });
  }

  // Store the active connections
  const availableUsers = new Map();

  // Handle socket.io connections
  io.on("connection", (socket) => {
    socket.emit("create", socket.id);
    console.log(`${socket.id} connected`);

    // Store the user's socket connection
    socket.on("reConnect", (interests) => {
      // console.log(interests.data);
      availableUsers.set(socket.id, interests.data);
    });

    socket.on("startChat", () => {
      matchSockets(socket);
    });

    // Handle offer signaling
    socket.on("call-user", (data) => {
      const { offer, targetSocketID } = JSON.parse(data);
      io.to(targetSocketID).emit("call-made", {
        sourceSocketID: socket.id,
        offer: offer,
      });
    });

    // Handle answer signaling
    socket.on("make-answer", (data) => {
      console.log("make-answer");
      const { answer, targetSocketID } = JSON.parse(data);
      io.to(targetSocketID).emit("answer-made", {
        sourceSocketID: socket.id,
        answer: answer,
      });
    });

    // Handle ICE candidate signaling
    socket.on("ice-candidate", (data) => {
      console.log("ice-candidate");
      const { targetSocketID, candidate } = JSON.parse(data);
      io.to(targetSocketID).emit("ice-candidate", {
        sourceSocketID: socket.id,
        candidate: candidate,
      });
    });

    socket.on("message", (data) => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("message", data);
    });

    socket.on("ask-increment", () => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("ask-increment");
    });

    socket.on("reply-increment", (data) => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("reply-increment", data);
    });

    socket.on("ask-chat", (data) => {
      const roomId = socket.data.roomId;
      const allData = JSON.parse(data);
      socket.to(roomId).emit("ask-chat", allData);
    });

    socket.on("reply-chat", (data) => {
      const roomId = socket.data.roomId;
      const allData = JSON.parse(data);
      socket.to(roomId).emit("reply-chat", allData);
    });

    socket.on("close-chat", () => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("close-chat");
    });

    socket.on("ask-exchange-numbers", () => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("ask-exchange-numbers");
    });
    socket.on("reply-exchange-numbers", (data) => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("reply-exchange-numbers", data);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      availableUsers.delete(socket.id);
      const roomId = socket.data.roomId;
      if (roomId) {
        socket.to(roomId).emit("hangup");
        // Clean up the room data
        socket.leave(roomId);
        delete socket.data.roomId;
      }
      console.log(`${socket.id} disconnected`);
    });
  });

  //messages-end


  // SUPERCHAT
  // PayPal configuration
  paypal.configure({
    mode: "sandbox", // Set 'live' for production mode
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET,
  });

  // Payment endpoint
  app.post("/payment", (req, res) => {
    const paymentAmount = req.body.amount; // Amount received from frontend

    const create_payment_json = {
      intent: "sale",
      payer: {
        payment_method: "paypal",
      },
      transactions: [
        {
          amount: {
            total: paymentAmount.toFixed(2),
            currency: "USD",
          },
        },
      ],
      redirect_urls: {
        return_url: process.env.PAYPAL_RETURN_URL,
        cancel_url: process.env.PAYPAL_CANCEL_URL,
      },
    };

    paypal.payment.create(create_payment_json, (error, payment) => {
      if (error) {
        res
          .status(500)
          .json({ status: "error", message: "Payment creation failed" });
      } else {
        for (let i = 0; i < payment.links.length; i++) {
          if (payment.links[i].rel === "approval_url") {
            res.json({ status: "created", approvalUrl: payment.links[i].href });
          }
        }
      }
    });
  });

  // Payment confirmation endpoint
  app.get("/payment/confirm", (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;

    const execute_payment_json = {
      payer_id: payerId,
    };

    paypal.payment.execute(paymentId, execute_payment_json, (error, payment) => {
      if (error) {
        res
          .status(500)
          .json({ status: "error", message: "Payment execution failed" });
      } else {
        res.json({ status: "success", message: "Payment successful" });
      }
    });
  });
  // Supercht end



  app.listen(port, () => {
    console.log(`this server is running on ${port}`);

  })
};
// Start the server

const initializeApp = async () => {
  await connectToMongo();
  await startServer();
}
// Invoke the initialization function
initializeApp();
